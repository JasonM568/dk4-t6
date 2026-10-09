/* 付款通知路由的 D 層（破壞性）驗證——**需要一個以假金鑰、死埠外呼啟動的本機 dev server**，並寫入本機 DB。
 *
 * 付款通知是錢進來的唯一入口：簽章、冪等、金額、狀態順序、併發、開票失敗，任何一個錯都是金流事故。
 * 這支腳本自己用『假金鑰』簽章，直接 POST 到 dev server 的 /api/payment/** 路由（經過完整的 Next 路由、
 * 真實的 settle 邏輯、真實的資料庫），檢查：
 *   G  護欄：確認 dev server 真的在用假金鑰（假金鑰簽的通知被接受、別把金鑰簽的被拒絕），否則整支中止
 *   S  簽章與請求格式：HashInfo 錯／缺、EncryptInfo 被改（GCM）、非 form、空 body、大 body、錯誤方法
 *   M  商店代號不符、金額竄改、查無單號與惡意單號
 *   T  三態與順序：pending（ATM 取號）、failed、先失敗後成功、先成功後失敗、已取消
 *   R  重放與併發：同一則通知重送／併發 → 只結算一次、消費只算一次、發票只試一次
 *   I  開票失敗（外呼死埠）→ 仍回 200、訂單仍 PAID、InvoiceRecord 記失敗可重試，不能回 500 造成無限重送
 *   X  訪客單：建帳號外呼失敗 → 錢不白收，改存待開通名單
 *   Y  場次單（session-notify）：同上的簽章、重放、併發、狀態、名單只建一次
 *   Z  return 導回路由與 ECPay 路由（PAYMENT_PROVIDER=payuni 時應拒收）、跨路由重放
 *
 * 啟動 dev server（先讀 scripts/dev-env.example.sh 檔頭的紅線；所有外呼都指向 127.0.0.1:1 死埠）：
 *   source scripts/dev-env.example.sh && pnpm dev -p 3100
 * 跑法：npx tsx scripts/test-payment-notify-abuse-db.ts
 *   （環境變數 NOTIFY_BASE 預設 http://localhost:3100；只允許 localhost／127.0.0.1） */
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import { payuniEncrypt, payuniHash } from "../src/lib/payment/payuni";

const BASE = process.env.NOTIFY_BASE ?? "http://localhost:3100";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`✗ NOTIFY_BASE 必須是 localhost／127.0.0.1，目前是 ${BASE}`);
  process.exit(1);
}

// 與 dev-env.sh 一致的假金鑰（絕非正式值）
// 預設值與 scripts/dev-env.example.sh 一致；dev server 若用別的假值，export NOTIFY_HASH_KEY／NOTIFY_HASH_IV 對齊
const MER = "TEST";
const KEY = process.env.NOTIFY_HASH_KEY ?? "FAKEKEYFAKEKEYFAKEKEYFAKEKEY0032";
const IV = process.env.NOTIFY_HASH_IV ?? "FAKEIVFAKEIV0016";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}

// ── 通知產生器 ──
type State = "paid" | "atm" | "unknown" | "failed" | "cancelled";
function inner(orderNo: string, amount: number | string, state: State, mer = MER): Record<string, string> {
  const base = { MerID: mer, MerTradeNo: orderNo, TradeAmt: String(amount), TradeNo: `TN${orderNo.slice(-8)}`, PaymentType: "1", Message: "ok", Timestamp: String(Math.floor(Date.now() / 1000)) };
  switch (state) {
    case "paid": return { ...base, Status: "SUCCESS", TradeStatus: "1" };
    case "atm": return { ...base, Status: "SUCCESS", TradeStatus: "0" };
    case "unknown": return { ...base, Status: "UNKNOWN", TradeStatus: "8" };
    case "failed": return { ...base, Status: "FAIL", TradeStatus: "2" };
    case "cancelled": return { ...base, Status: "SUCCESS", TradeStatus: "3" };
  }
}
function signed(fields: Record<string, string>, key = KEY, iv = IV): URLSearchParams {
  const qs = new URLSearchParams(fields).toString();
  const enc = payuniEncrypt(qs, key, iv);
  return new URLSearchParams({ Status: fields.Status ?? "SUCCESS", Message: "ok", MerID: fields.MerID ?? MER, Version: "2.0", EncryptInfo: enc, HashInfo: payuniHash(enc, key, iv) });
}
async function post(path: string, body: URLSearchParams | string | Uint8Array | null, headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" }, method = "POST") {
  const res = await fetch(`${BASE}${path}`, { method, body: method === "GET" ? undefined : (body as BodyInit | null), headers, redirect: "manual", signal: AbortSignal.timeout(90_000) });
  return { status: res.status, text: await res.text().catch(() => ""), location: res.headers.get("location") ?? "" };
}
const NOTIFY = "/api/payment/payuni/notify";
const SNOTIFY = "/api/payment/payuni/session-notify";
const notify = (f: Record<string, string>, path = NOTIFY) => post(path, signed(f));

// ── 測試資料 ──
const D = "@pn-abuse.localhost";
const COURSE = "test-pn-course";
const SESSION = "test-pn-session";
const U = (n: number) => `00000000-0000-4000-8000-${String(4000 + n).padStart(12, "0")}`;
const USERS = Array.from({ length: 40 }, (_, i) => U(i));
let seq = 0;
const ono = (p = "PN") => `${p}${Date.now().toString().slice(-8)}${String(++seq).padStart(4, "0")}`;

async function cleanup() {
  const orders = await prisma.order.findMany({ where: { OR: [{ buyerEmail: { endsWith: D } }, { userId: { in: USERS } }] }, select: { id: true } });
  const sorders = await prisma.sessionSignupOrder.findMany({ where: { sessionId: SESSION }, select: { id: true } });
  await prisma.invoiceRecord.deleteMany({ where: { orderId: { in: [...orders.map((o) => o.id), ...sorders.map((o) => o.id)] } } });
  await prisma.enrollment.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { courseId: COURSE }] } });
  await prisma.pendingEnrollment.deleteMany({ where: { OR: [{ courseId: COURSE }, { email: { endsWith: D } }] } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.memberStats.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SESSION } });
  await prisma.sessionSignupOrder.deleteMany({ where: { sessionId: SESSION } });
  await prisma.courseSession.deleteMany({ where: { id: SESSION } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
}

async function memberOrder(u: number, total = 1000, status = "PENDING") {
  const orderNo = ono();
  await prisma.order.create({
    data: {
      orderNo, checkoutKey: `${U(u)}:${COURSE}:${orderNo}`, userId: U(u), buyerEmail: `m${u}${D}`, buyerName: "通知測試", buyerPhone: "0912345678",
      status: status as never, subtotal: total, discount: 0, total,
      items: { create: [{ courseId: COURSE, unitPrice: total }] },
      payment: { create: { provider: "payuni", status: "PENDING", amount: total } },
    },
  });
  return orderNo;
}
const ord = (no: string) => prisma.order.findUnique({ where: { orderNo: no } });
const enr = (u: number) => prisma.enrollment.count({ where: { userId: U(u), courseId: COURSE } });
const stats = (u: number) => prisma.memberStats.findUnique({ where: { userId: U(u) } });
const inv = async (no: string) => {
  const o = await ord(no);
  return o ? prisma.invoiceRecord.findUnique({ where: { orderId: o.id } }) : null;
};

async function sessionOrder(n: number, total = 2000, qty = 2) {
  const orderNo = `WEB-PN${Date.now().toString().slice(-6)}${String(++seq).padStart(3, "0")}`.slice(0, 25);
  await prisma.sessionSignupOrder.create({
    data: {
      orderNo, sessionId: SESSION, checkoutKey: `${SESSION}:s${n}${D}`, buyerEmail: `s${n}${D}`, buyerName: "場次買家", buyerPhone: "0912345678",
      attendees: Array.from({ length: qty }, (_, i) => ({ name: `參加者${n}-${i}`, phone: `09${String(60_000_000 + n * 10 + i)}`, email: null, meal: "MEAT", isRetrain: false })),
      quantity: qty, unitPrice: total / qty, total, status: "PENDING", provider: "payuni",
    },
  });
  return orderNo;
}
const sord = (no: string) => prisma.sessionSignupOrder.findUnique({ where: { orderNo: no } });
const signups = (no: string) => prisma.sessionSignup.count({ where: { sessionId: SESSION, orderNo: no } });

async function main() {
  await cleanup();
  await prisma.course.create({ data: { id: COURSE, slug: COURSE, title: "通知測試課", description: "測試用", price: 1000, courseCode: "TPN-001" } });
  await prisma.courseSession.create({ data: { id: SESSION, title: "通知測試場次", signupSlug: SESSION, isSignupOpen: true } });

  // ═══ G 護欄 ═══
  console.log("\nG. 護欄：確認 dev server 在用假金鑰");
  {
    const ok = await notify(inner("PN-NO-SUCH-ORDER", 1000, "paid"));
    const bad = await post(NOTIFY, signed(inner("PN-NO-SUCH-ORDER", 1000, "paid"), "x".repeat(32), "y".repeat(16)));
    check("假金鑰簽的通知被接受（200）", ok.status === 200, `status=${ok.status} ${ok.text.slice(0, 60)}`);
    check("別把金鑰簽的通知被拒絕（400 hash mismatch）", bad.status === 400, `status=${bad.status} ${bad.text.slice(0, 60)}`);
    if (ok.status !== 200 || bad.status !== 400) {
      console.error("\n✗ 護欄失敗：dev server 不是用假金鑰在運作（或金鑰與本腳本不一致，可 export NOTIFY_HASH_KEY／NOTIFY_HASH_IV 對齊），為了安全中止整支測試。");
      await cleanup();
      process.exit(2);
    }
  }

  // ═══ S ═══
  console.log("\nS. 簽章與請求格式");
  {
    const no = await memberOrder(0);
    const good = inner(no, 1000, "paid");
    const qs = signed(good);
    const noChange = async (label: string, r: { status: number }, expect: number | number[]) => {
      const o = await ord(no);
      const exp = Array.isArray(expect) ? expect : [expect];
      check(`${label} → ${exp.join("／")}，訂單仍 PENDING、沒有開通`, exp.includes(r.status) && o?.status === "PENDING" && (await enr(0)) === 0, `status=${r.status} 訂單=${o?.status}`);
    };
    await noChange("HashInfo 改一個字元", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), HashInfo: qs.get("HashInfo")!.replace(/.$/, (c) => (c === "A" ? "B" : "A")) })), 400);
    await noChange("缺 HashInfo", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), HashInfo: "" })), 400);
    await noChange("缺 EncryptInfo", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), EncryptInfo: "" })), 400);
    // 只改密文、HashInfo 依新密文重算（攻擊者不知道金鑰，但能算 SHA256 的情境：不知道金鑰就算不出來；這裡模擬『有人能重算 HashInfo』，靠 GCM 驗證擋）
    const enc = qs.get("EncryptInfo")!;
    const flipped = enc.slice(0, 40) + (enc[40] === "a" ? "b" : "a") + enc.slice(41);
    await noChange("密文被改且 HashInfo 重算（只剩 GCM 驗證能擋）", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), EncryptInfo: flipped, HashInfo: payuniHash(flipped, KEY, IV) })), 400);
    await noChange("EncryptInfo 不是 hex／亂碼", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), EncryptInfo: "zzzz!!", HashInfo: payuniHash("zzzz!!", KEY, IV) })), 400);
    await noChange("JSON body（Content-Type 不是表單）", await post(NOTIFY, JSON.stringify({ EncryptInfo: "x" }), { "content-type": "application/json" }), 400);
    await noChange("空 body", await post(NOTIFY, "", { "content-type": "application/x-www-form-urlencoded" }), 400);
    await noChange("沒有 Content-Type 的純文字", await post(NOTIFY, "garbage", {}), 400);
    await noChange("5MB 垃圾 body", await post(NOTIFY, "a=".concat("x".repeat(5_000_000))), 400);
    await noChange("GET 方法", await post(NOTIFY, null, {}, "GET"), [404, 405]);
    await noChange("HashInfo 小寫（等價於同一個雜湊）→ 驗章通過但這一筆是『尚未結算』的正確通知，此處只確認不 500", await post(NOTIFY, new URLSearchParams({ ...Object.fromEntries(qs), HashInfo: qs.get("HashInfo")!.toLowerCase(), EncryptInfo: payuniEncrypt(new URLSearchParams(inner(no, 1, "paid")).toString(), KEY, IV) })), 400);
    const r = await notify(good);
    check("同一筆用完整正確的簽章 → 200 並結算", r.status === 200 && (await ord(no))?.status === "PAID" && (await enr(0)) === 1, `status=${r.status} 訂單=${(await ord(no))?.status}`);
  }

  // ═══ M ═══
  console.log("\nM. 商店代號、金額、單號");
  {
    const no = await memberOrder(1);
    const r1 = await notify(inner(no, 1000, "paid", "OTHER"));
    check("簽章正確但 MerID 不是本店 → 200（停止重送）且不結算", r1.status === 200 && (await ord(no))?.status === "PENDING" && (await enr(1)) === 0);
    for (const amt of ["999", "1001", "0", "-1000", "abc", "1000.5", "99999999999", ""]) {
      const r = await notify(inner(no, amt, "paid"));
      check(`金額 '${amt}' → 不結算、不 500`, r.status === 200 && (await ord(no))?.status === "PENDING" && (await enr(1)) === 0, `status=${r.status} 訂單=${(await ord(no))?.status}`);
    }
    for (const [label, s] of [["不存在的單號", "PN-NO-SUCH-0001"], ["SQL 字樣", "' OR '1'='1"], ["引號與分號", "x'; DROP TABLE \"Order\"; --"], ["1 萬字元", "A".repeat(10_000)], ["路徑穿越", "../../etc/passwd"], ["空單號", ""], ["emoji", "🍣".repeat(20)]] as const) {
      const r = await notify(inner(s, 1000, "paid"));
      check(`單號：${label} → 200／400，不 500`, [200, 400].includes(r.status), `status=${r.status}`);
    }
    check("Order 表仍在", (await prisma.order.count()) >= 1);
  }

  // ═══ T ═══
  console.log("\nT. 三態與順序");
  {
    const a = await memberOrder(2);
    await notify(inner(a, 1000, "atm"));
    await notify(inner(a, 1000, "unknown"));
    check("ATM 取號成功／UNKNOWN（pending）→ 訂單維持 PENDING，不被標 FAILED", (await ord(a))?.status === "PENDING" && (await ord(a))?.checkoutKey !== null);
    await notify(inner(a, 1000, "paid"));
    check("ATM 先取號、事後繳款成功 → 轉 PAID 並開通", (await ord(a))?.status === "PAID" && (await enr(2)) === 1);

    const b = await memberOrder(3);
    await notify(inner(b, 1000, "failed"));
    const bo = await ord(b);
    check("付款失敗 → FAILED 並釋放防重鍵", bo?.status === "FAILED" && bo.checkoutKey === null);
    await notify(inner(b, 1000, "paid"));
    check("先失敗、同一單稍後付款成功（重試成功）→ 轉 PAID 並開通（錢收了就要給課）", (await ord(b))?.status === "PAID" && (await enr(3)) === 1, `訂單=${(await ord(b))?.status} 開通=${await enr(3)}`);

    const c = await memberOrder(4);
    await notify(inner(c, 1000, "paid"));
    await notify(inner(c, 1000, "failed"));
    await notify(inner(c, 1000, "atm"));
    await notify(inner(c, 1000, "cancelled"));
    check("先成功、遲到的失敗／取號／取消通知 → 不翻盤，仍 PAID 且開通", (await ord(c))?.status === "PAID" && (await enr(4)) === 1);

    const d = await memberOrder(5, 1000, "CANCELLED");
    const dr = await notify(inner(d, 1000, "paid"));
    check("已取消的單收到付款成功 → 200 但不開通（留待人工退款）", dr.status === 200 && (await ord(d))?.status === "CANCELLED" && (await enr(5)) === 0);
  }

  // ═══ R ═══
  console.log("\nR. 重放與併發");
  {
    const a = await memberOrder(6);
    for (let i = 0; i < 10; i++) await notify(inner(a, 1000, "paid"));
    const st = await stats(6);
    check("同一則成功通知循序重送 10 次 → 只開通 1 次、消費只算一次、購課數 1", (await enr(6)) === 1 && st?.totalSpent === 1000 && st?.coursesBought === 1, `開通=${await enr(6)} 消費=${st?.totalSpent} 購課=${st?.coursesBought}`);
    check("發票只嘗試 1 次（重送不重複開票）", (await inv(a))?.attempts === 1, `attempts=${(await inv(a))?.attempts}`);

    const b = await memberOrder(7);
    const rs = await Promise.all(Array.from({ length: 10 }, () => notify(inner(b, 1000, "paid"))));
    const st2 = await stats(7);
    check("同一則成功通知併發 10 次 → 全部回 200（沒有 500 造成金流商無限重送）", rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
    check("併發 10 次 → 只開通 1 次、消費只算一次", (await enr(7)) === 1 && st2?.totalSpent === 1000, `開通=${await enr(7)} 消費=${st2?.totalSpent}`);
    check("併發 10 次 → 發票只嘗試 1 次", (await inv(b))?.attempts === 1, `attempts=${(await inv(b))?.attempts}`);
  }

  // ═══ I ═══
  console.log("\nI. 開票外呼失敗（死埠）");
  {
    const a = await memberOrder(8);
    const r = await notify(inner(a, 1000, "paid"));
    const iv = await inv(a);
    check("開票失敗不影響結果：通知回 200（不是 500）", r.status === 200, `status=${r.status}`);
    check("訂單 PAID、課程已開通", (await ord(a))?.status === "PAID" && (await enr(8)) === 1);
    check("InvoiceRecord 記為 FAILED 並留下原因，可由後台重試", iv?.status === "FAILED" && !!iv.error, JSON.stringify({ s: iv?.status, e: iv?.error?.slice(0, 40) }));
  }

  // ═══ X ═══
  const emptyKey = process.env.NOTIFY_EMPTY_SECRET === "1"; // dev server 以空的 SUPABASE_SECRET_KEY 啟動時設 1，僅影響標籤
  console.log(`\nX. 訪客單：建帳號失敗${emptyKey ? "（SUPABASE_SECRET_KEY 為空 → createAdminClient 會 throw）" : "（Supabase 外呼指向死埠）"}`);
  {
    const no = ono();
    await prisma.order.create({
      data: {
        orderNo: no, checkoutKey: `guest:g1${D}:${COURSE}`, userId: null, buyerEmail: `g1${D}`, buyerName: "訪客", buyerPhone: "0912345678", status: "PENDING", subtotal: 1000, discount: 0, total: 1000,
        items: { create: [{ courseId: COURSE, unitPrice: 1000 }] }, payment: { create: { provider: "payuni", status: "PENDING", amount: 1000 } },
      },
    });
    const r = await notify(inner(no, 1000, "paid"));
    const o = await ord(no);
    check("建帳號失敗時通知仍回 200", r.status === 200, `status=${r.status}`);
    check("錢不白收：訂單標 PAID 並改存待開通名單（PendingEnrollment）", o?.status === "PAID" && (await prisma.pendingEnrollment.count({ where: { courseId: COURSE, email: `g1${D}` } })) === 1, `訂單=${o?.status}`);
    check("沒有建立任何 Enrollment（尚無帳號）", (await prisma.enrollment.count({ where: { courseId: COURSE, userId: { in: USERS } } })) >= 0 && o?.userId === null);
  }

  // ═══ Y ═══
  console.log("\nY. 場次單（session-notify）");
  {
    const a = await sessionOrder(1);
    const bad = await post(SNOTIFY, signed(inner(a, 2000, "paid"), "x".repeat(32), "y".repeat(16)));
    check("簽章錯誤 → 400，單仍 PENDING", bad.status === 400 && (await sord(a))?.status === "PENDING");
    for (const amt of ["1999", "2001", "0", "-2000", "abc"]) {
      const r = await notify(inner(a, amt, "paid"), SNOTIFY);
      check(`金額 '${amt}' → 不結算`, r.status === 200 && (await sord(a))?.status === "PENDING" && (await signups(a)) === 0);
    }
    const mer = await notify(inner(a, 2000, "paid", "OTHER"), SNOTIFY);
    check("MerID 不符 → 200 且不結算", mer.status === 200 && (await sord(a))?.status === "PENDING");
    await notify(inner(a, 2000, "atm"), SNOTIFY);
    check("ATM 取號（pending）→ 維持 PENDING", (await sord(a))?.status === "PENDING");
    await notify(inner(a, 2000, "paid"), SNOTIFY);
    check("付款成功 → PAID，2 位參加者進正式名單", (await sord(a))?.status === "PAID" && (await signups(a)) === 2, `名單=${await signups(a)}`);
    for (let i = 0; i < 5; i++) await notify(inner(a, 2000, "paid"), SNOTIFY);
    await notify(inner(a, 2000, "failed"), SNOTIFY);
    check("重送 5 次與遲到的失敗通知 → 名單仍是 2 筆、狀態仍 PAID", (await signups(a)) === 2 && (await sord(a))?.status === "PAID");
    const sInv = await prisma.invoiceRecord.findUnique({ where: { orderId: (await sord(a))!.id } });
    check("場次單開票失敗 → InvoiceRecord FAILED 可重試，通知不回 500", sInv?.status === "FAILED" && !!sInv.error, JSON.stringify({ s: sInv?.status, att: sInv?.attempts }));

    const b = await sessionOrder(2);
    const rs = await Promise.all(Array.from({ length: 8 }, () => notify(inner(b, 2000, "paid"), SNOTIFY)));
    check("同一則成功通知併發 8 次 → 全部回 200（沒有 500）", rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
    check("併發 8 次 → 名單只建 2 筆、狀態 PAID", (await signups(b)) === 2 && (await sord(b))?.status === "PAID", `名單=${await signups(b)} 狀態=${(await sord(b))?.status}`);
    // 只靠 savepoint 也能讓『名單 2 筆＋全 200』變綠，但分辨不出同一則通知被結算了多次。
    // 每一次真正走到『尚未結算』分支的請求，結算後都會去開一次發票，所以發票嘗試次數 = 結算次數；
    // 只有第一個請求該結算，其餘 7 個都該走『已結算（already）』而不開票。
    const bInv = await prisma.invoiceRecord.findMany({ where: { orderId: (await sord(b))!.id } });
    check("併發 8 次 → 發票只嘗試 1 次（= 只結算 1 次，其餘 7 個是 already）；多於 1 次代表同一則通知被重複結算", bInv.length === 1 && bInv[0].attempts === 1, `InvoiceRecord ${bInv.length} 筆、attempts=${bInv.map((x) => x.attempts).join(",")}`);
    const bOrder = await sord(b);
    check("併發 8 次 → 訂單只有一組金流存證（tradeNo 只對應第一個請求）", !!bOrder?.tradeNo && bOrder.paidAt !== null);

    const c = await sessionOrder(3);
    await notify(inner(c, 2000, "failed"), SNOTIFY);
    const co = await sord(c);
    check("付款失敗 → FAILED 並釋放防重鍵", co?.status === "FAILED" && co.checkoutKey === null);
    await prisma.sessionSignupOrder.update({ where: { orderNo: c }, data: { status: "CANCELLED" } });
    await notify(inner(c, 2000, "paid"), SNOTIFY);
    check("已取消的場次單收到付款成功 → 不進名單", (await sord(c))?.status === "CANCELLED" && (await signups(c)) === 0);
  }

  // ═══ Z ═══
  console.log("\nZ. return 路由、ECPay 路由與跨路由重放");
  {
    const no = await memberOrder(9);
    const okRet = await post("/api/payment/payuni/return", signed(inner(no, 1000, "paid")));
    check("return：簽章正確 → 303 導向該單頁", okRet.status === 303 && okRet.location.endsWith(`/orders/${no}`), `${okRet.status} ${okRet.location}`);
    check("return 本身不改訂單狀態（狀態只以 notify 為準）", (await ord(no))?.status === "PENDING");
    const badRet = await post("/api/payment/payuni/return", signed(inner(no, 1000, "paid"), "x".repeat(32), "y".repeat(16)));
    check("return：簽章錯誤 → 303 導回『我的課程』，網址裡沒有單號", badRet.status === 303 && !badRet.location.includes(no) && /my-courses/.test(badRet.location), `${badRet.status} ${badRet.location}`);
    const jsonRet = await post("/api/payment/payuni/return", JSON.stringify({ a: 1 }), { "content-type": "application/json" });
    check("return：非表單 body → 303 導回、不 500", jsonRet.status === 303, `status=${jsonRet.status}`);
    const sNo = await sessionOrder(4);
    const sRet = await post("/api/payment/payuni/session-return", signed(inner(sNo, 2000, "paid")));
    check("session-return：簽章正確 → 303 導向落地頁並帶單號（編碼後）", sRet.status === 303 && sRet.location.includes(`/event/thanks?order=${encodeURIComponent(sNo)}`), `${sRet.status} ${sRet.location}`);
    const sBad = await post("/api/payment/payuni/session-return", signed(inner(sNo, 2000, "paid"), "x".repeat(32), "y".repeat(16)));
    check("session-return：簽章錯誤 → 導回落地頁、不帶單號", sBad.status === 303 && !sBad.location.includes(sNo), `${sBad.status} ${sBad.location}`);

    const ec = await post("/api/payment/ecpay/notify", new URLSearchParams({ MerchantTradeNo: no, RtnCode: "1", TradeAmt: "1000", CheckMacValue: "00" }));
    check("PAYMENT_PROVIDER=payuni 時，ECPay notify 不會被當成成功（回應不是 1|OK）且不動訂單", ec.text.trim() !== "1|OK" && (await ord(no))?.status === "PENDING", `status=${ec.status} ${ec.text.slice(0, 40)}`);
    const ecs = await post("/api/payment/ecpay/session-notify", new URLSearchParams({ MerchantTradeNo: sNo, RtnCode: "1", TradeAmt: "2000", CheckMacValue: "00" }));
    check("ECPay session-notify 同樣不會被當成成功且不動訂單", ecs.text.trim() !== "1|OK" && (await sord(sNo))?.status === "PENDING", `status=${ecs.status} ${ecs.text.slice(0, 40)}`);

    // 跨路由重放：把課程單的合法通知打到場次路由，反之亦然
    const cross1 = await notify(inner(no, 1000, "paid"), SNOTIFY);
    const cross2 = await notify(inner(sNo, 2000, "paid"), NOTIFY);
    check("課程單的通知打到場次路由、場次單的通知打到課程路由 → 查無此單，兩邊都不動", cross1.status === 200 && cross2.status === 200 && (await ord(no))?.status === "PENDING" && (await sord(sNo))?.status === "PENDING");
  }

  await cleanup();
  console.log("\n  （測試資料已清理）");
}

main()
  .catch((e) => {
    fail++;
    console.error("✗ 例外：", e);
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
