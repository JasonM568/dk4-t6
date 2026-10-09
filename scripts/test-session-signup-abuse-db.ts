/* 場次公開報名頁 ＋ 平台金流結帳的 D 層（破壞性）驗證——會寫入資料庫，**只能對本機 localhost 跑**。
 *
 * 直接呼叫公開的 server action（submitSignupAction／createSessionCheckout／previewSessionPricing），
 * 等同攻擊者繞過前端表單直打：
 *   A. 基準：正常報名成功、只寄一封信給訂購人
 *   B. 名額超賣：名額剩 N 時 M 個人同時送出（先數再寫沒有鎖）
 *   C. 重複：同一位參加者用不同訂購人信箱同時送出；同信箱連點
 *   D. 吞單：同信箱 60 秒內為不同的人報名，第二筆是否被靜默吞掉卻回報成功
 *   E. 報名方式：場次設為 PLATFORM／EXTERNAL，手動報名入口是否還收件（佔名額但永遠不會有人收款）
 *   F. 關閉狀態：總開關關、未開始、已截止、已滿 → 拒絕且零寫入、零寄信
 *   G. 蜜罐、參加者超過上限、畸形與超長欄位、header injection 式信箱
 *   H. 惡意 slug
 *   I. 平台金流結帳：名額、同信箱併發、改價（表單塞 price／total／isRetrain）、蜜罐
 *   J. 試算端點被灌入大量聯絡人
 *
 * 不碰任何外部服務：寄信（@/lib/email/broadcast）與金流（@/lib/payment）、auth/staff、next/cache
 * 全部以 Module._load 換成本機替身；全程固定測試場次 id。
 * 跑法：npx tsx --conditions=react-server scripts/test-session-signup-abuse-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import Module from "node:module";

// ── 替身：所有會碰外部或需要 Next 請求環境的模組 ──
const sentMails: { to: string; subject: string }[] = [];
// R13 起公開表單依來源 IP 限流（同 IP 10 分鐘 20 次）。直打 action 沒有 request，這裡用 next/headers 替身
// 提供 x-real-ip，並在每個段落換一個 pid 隔離的 IP——門檻不放寬，只是避免不同段落共用同一個額度。
const PID = process.pid;
let ipN = 0;
let currentIp = `198.51.100.${PID}-0`;
const setIp = () => { currentIp = `198.51.100.${PID}-${++ipN}`; };
type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/auth/staff") {
    const ok = async () => "admin";
    return { requireEditor: ok, requireStaff: ok, requireFullAdmin: ok, currentStaffRole: async () => null };
  }
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/headers") return { headers: async () => new Headers({ "x-real-ip": currentIp }), cookies: async () => ({ get: () => undefined, set() {}, delete() {} }) };
  if (request === "@/lib/email/broadcast") {
    return {
      buildBroadcastHtml: () => "<p>stub</p>",
      sendBroadcast: async (recipients: { email: string }[], subject: string) => {
        for (const r of recipients) sentMails.push({ to: r.email, subject });
        return { sent: recipients.length, failed: 0, failedRecipients: [], acceptedRecipients: [] };
      },
    };
  }
  if (request === "@/lib/payment") {
    return {
      getPaymentProvider: () => ({
        name: "payuni",
        createPayment: (i: { amount: number; orderNo: string }) => ({ action: "https://127.0.0.1:1/pay", fields: { amount: String(i.amount), orderNo: i.orderNo } }),
      }),
    };
  }
  return origLoad.call(this, request, ...rest);
};

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

const SID = "test-abuse-session";
const SLUG = "test-abuse-slug";
const DAY = 24 * 3600 * 1000;
const quiet = console.error;

const CC = "test-abuse-cc";
const RAW = "測試課名-D層";
const VET_PHONE = "0900000071";
const VET_EMAIL = "veteran-abuse@localhost.test";
async function cleanup() {
  await prisma.studentRecord.deleteMany({ where: { OR: [{ phone: VET_PHONE }, { email: VET_EMAIL }] } });
  await prisma.studentCourseAlias.deleteMany({ where: { courseId: CC } });
  await prisma.canonicalCourse.deleteMany({ where: { id: CC } });
  await prisma.sessionSignupOrder.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignupRequest.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
}

async function resetSession(over: Record<string, unknown> = {}) {
  await prisma.sessionSignupOrder.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignupRequest.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
  sentMails.length = 0;
  return prisma.courseSession.create({
    data: {
      id: SID, title: "D 層測試場次", signupSlug: SLUG, isSignupOpen: true, signupPayMode: "MANUAL",
      signupQuota: null, signupPrice: 1000, ...over,
    },
  });
}

let phoneSeq = 0;
/** 產生唯一的合法手機（09 + 8 位），避免同行者撞號／重複報名誤判 */
const phone = () => `09${String(10_000_000 + ++phoneSeq).padStart(8, "0")}`;

function form(o: { buyerEmail: string; attendees?: { name: string; phone?: string; email?: string }[]; note?: string; extra?: Record<string, string> }) {
  const fd = new FormData();
  fd.set("buyerEmail", o.buyerEmail);
  (o.attendees ?? [{ name: `甲${phoneSeq}` }]).forEach((a, i) => {
    fd.set(`attendee-${i}-name`, a.name);
    fd.set(`attendee-${i}-phone`, a.phone ?? phone());
    if (a.email) fd.set(`attendee-${i}-email`, a.email);
  });
  if (o.note) fd.set("note", o.note);
  for (const [k, v] of Object.entries(o.extra ?? {})) fd.set(k, v);
  return fd;
}

const rowsOf = () => prisma.sessionSignupRequest.findMany({ where: { sessionId: SID } });

async function main() {
  const { submitSignupAction } = await import("../src/actions/session-signup");
  const { createSessionCheckout, previewSessionPricing } = await import("../src/actions/session-checkout");
  await cleanup();

  console.log("\nA. 基準");
  setIp();
  {
    await resetSession({ signupQuota: 10 });
    const r = await submitSignupAction(SLUG, null, form({ buyerEmail: "a1@localhost.test", attendees: [{ name: "王小明", email: "friend@localhost.test" }] }));
    check("正常報名 → 成功", !!r && "success" in r && !!r.success, JSON.stringify(r));
    check("寫入 1 筆待確認", (await rowsOf()).length === 1);
    check("只寄一封信，收件人只有訂購人（不會寄給參加者填的其他信箱）", sentMails.length === 1 && sentMails[0].to === "a1@localhost.test", JSON.stringify(sentMails));
  }

  console.log("\nB. 名額超賣（名額 3、8 人同時各報 1 位）");
  setIp();
  {
    await resetSession({ signupQuota: 3 });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => submitSignupAction(SLUG, null, form({ buyerEmail: `race${i}@localhost.test`, attendees: [{ name: `搶位${i}` }] }))));
    const n = (await rowsOf()).length;
    const okN = rs.filter((r) => r && "success" in r && r.success).length;
    check("名額 3 時，同時送出 8 筆，最多只收 3 位", n <= 3, `實際收下 ${n} 位（回報成功 ${okN} 筆）——先數再寫沒有鎖，超賣 ${Math.max(0, n - 3)} 位`);
  }

  console.log("\nC. 重複報名");
  setIp();
  {
    await resetSession({ signupQuota: null });
    const same = { name: "同一人", phone: phone() };
    await Promise.all(Array.from({ length: 4 }, (_, i) => submitSignupAction(SLUG, null, form({ buyerEmail: `dup${i}@localhost.test`, attendees: [same] }))));
    const n = (await rowsOf()).filter((r) => r.phone === same.phone).length;
    check("同一位參加者（同姓名同手機）用 4 個不同訂購人信箱同時送出 → 只能有 1 筆", n === 1, `實際 ${n} 筆`);

    await resetSession({ signupQuota: null });
    const p = phone();
    await Promise.all(Array.from({ length: 5 }, () => submitSignupAction(SLUG, null, form({ buyerEmail: "click@localhost.test", attendees: [{ name: "連點", phone: p }] }))));
    const orders = new Set((await rowsOf()).map((r) => r.orderNo));
    check("同信箱同人連點 5 次（併發）→ 只能有 1 張報名單", orders.size === 1, `實際 ${orders.size} 張`);
  }

  console.log("\nD. 60 秒重複視窗的副作用");
  setIp();
  {
    await resetSession({ signupQuota: null });
    await submitSignupAction(SLUG, null, form({ buyerEmail: "mom@localhost.test", attendees: [{ name: "大寶" }] }));
    const r2 = await submitSignupAction(SLUG, null, form({ buyerEmail: "mom@localhost.test", attendees: [{ name: "二寶" }] }));
    const names = (await rowsOf()).map((r) => r.name);
    const said = !!r2 && "success" in r2 && !!r2.success;
    check("同一位家長 60 秒內分兩次替兩個孩子報名：回報成功就必須真的寫入（不可靜默吞掉第二位）", !said || names.includes("二寶"),
      `第二次回報成功，但資料庫只有 ${JSON.stringify(names)}——二寶沒報到，家長以為成功了`);
  }

  console.log("\nE. 報名方式不是 MANUAL，手動報名入口仍收件？");
  setIp();
  for (const mode of ["PLATFORM", "EXTERNAL"]) {
    await resetSession({ signupPayMode: mode, signupQuota: 5, signupUrl: mode === "EXTERNAL" ? "https://example.test/1shop" : null });
    const r = await submitSignupAction(SLUG, null, form({ buyerEmail: `mode-${mode}@localhost.test` }));
    const n = (await rowsOf()).length;
    check(`場次是 ${mode} 模式時，直打手動報名入口應被拒絕（頁面不會給這張表單）`, n === 0 && !!r && "error" in r,
      `寫入 ${n} 筆待確認並佔用名額、寄出 ${sentMails.length} 封『請依信中說明繳費』的信；實際收款流程不是手動`);
  }

  console.log("\nF. 關閉狀態");
  setIp();
  {
    const cases: [string, Record<string, unknown>][] = [
      ["總開關關閉", { isSignupOpen: false }],
      ["報名尚未開始", { signupOpenAt: new Date(Date.now() + DAY) }],
      ["報名已截止", { signupCloseAt: new Date(Date.now() - DAY) }],
      ["沒設截止且開課日已過", { eventDate: new Date(Date.now() - 3 * DAY) }],
    ];
    for (const [label, over] of cases) {
      await resetSession(over);
      const r = await submitSignupAction(SLUG, null, form({ buyerEmail: "late@localhost.test" }));
      check(`${label} → 拒絕、零寫入、零寄信`, !!r && "error" in r && (await rowsOf()).length === 0 && sentMails.length === 0, JSON.stringify(r));
    }
    await resetSession({ signupQuota: 1 });
    await submitSignupAction(SLUG, null, form({ buyerEmail: "first@localhost.test" }));
    const r = await submitSignupAction(SLUG, null, form({ buyerEmail: "second@localhost.test" }));
    check("已滿額（依序）→ 拒絕", !!r && "error" in r && (await rowsOf()).length === 1);
    await resetSession({ signupQuota: 2 });
    const r3 = await submitSignupAction(SLUG, null, form({ buyerEmail: "big@localhost.test", attendees: [{ name: "甲" }, { name: "乙" }, { name: "丙" }] }));
    check("一次報 3 位但只剩 2 位名額 → 拒絕，名單零變動", !!r3 && "error" in r3 && (await rowsOf()).length === 0);
  }

  console.log("\nG. 蜜罐、人數上限、畸形與超長欄位");
  setIp();
  {
    await resetSession({ signupQuota: null });
    const r = await submitSignupAction(SLUG, null, form({ buyerEmail: "bot@localhost.test", extra: { hp_extra_note: "http://spam" } }));
    check("蜜罐有值 → 回成功但零寫入、零寄信", !!r && "success" in r && (await rowsOf()).length === 0 && sentMails.length === 0);

    await resetSession({ signupQuota: null });
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `人${i}` }));
    await submitSignupAction(SLUG, null, form({ buyerEmail: "many@localhost.test", attendees: many }));
    check("直接送 20 位參加者 → 最多只處理上限（6 位），多的不寫入", (await rowsOf()).length <= 6, `實際 ${(await rowsOf()).length} 筆`);

    const bad: [string, () => FormData, boolean][] = [
      ["訂購人信箱含換行（header injection）", () => form({ buyerEmail: "a@b.com\r\nBcc: victim@x.com" }), false],
      ["訂購人信箱含空白", () => form({ buyerEmail: "a b@c.com" }), false],
      ["沒有 @ 的信箱", () => form({ buyerEmail: "not-an-email" }), false],
      ["手機含字母", () => form({ buyerEmail: "p@localhost.test", attendees: [{ name: "x", phone: "09abc12345" }] }), false],
      ["手機太短", () => form({ buyerEmail: "p2@localhost.test", attendees: [{ name: "x", phone: "0912" }] }), false],
      ["沒有任何參加者", () => { const f = new FormData(); f.set("buyerEmail", "none@localhost.test"); return f; }, false],
    ];
    for (const [label, mk, shouldPass] of bad) {
      await resetSession({ signupQuota: null });
      let r: unknown;
      try { r = await submitSignupAction(SLUG, null, mk()); } catch (e) { r = { threw: String(e).slice(0, 60) }; }
      const n = (await rowsOf()).length;
      check(`${label} → 拒絕且不 throw、零寫入`, !shouldPass && n === 0 && !!r && typeof r === "object" && "error" in (r as object), JSON.stringify(r));
    }

    await resetSession({ signupQuota: null });
    await submitSignupAction(SLUG, null, form({ buyerEmail: "fw@localhost.test", attendees: [{ name: "全形", phone: "０９１２３４５６７８" }] }));
    check("全形數字手機被正規化成半形再存（0912345678），不會存進全形字元", (await rowsOf()).map((r) => r.phone).join() === "0912345678", JSON.stringify((await rowsOf()).map((r) => r.phone)));

    // 超長與特殊字元
    await resetSession({ signupQuota: null });
    const longName = "長".repeat(100_000);
    let longRes: unknown;
    try { longRes = await submitSignupAction(SLUG, null, form({ buyerEmail: "long@localhost.test", attendees: [{ name: longName }], note: "註".repeat(1_000_000) })); } catch (e) { longRes = { threw: String(e).slice(0, 60) }; }
    const stored = await rowsOf();
    const maxName = Math.max(0, ...stored.map((r) => r.name.length));
    const maxNote = Math.max(0, ...stored.map((r) => r.note?.length ?? 0));
    check("超長姓名（10 萬字）、備註（100 萬字）不 throw", !(longRes && typeof longRes === "object" && "threw" in (longRes as object)), JSON.stringify(longRes).slice(0, 120));
    check("超長輸入要被拒絕或截斷（姓名 ≤ 100 字、備註 ≤ 5000 字），不可原樣存進資料庫與寄進確認信",
      stored.length === 0 || (maxName <= 100 && maxNote <= 5000), `實際存入 姓名 ${maxName} 字、備註 ${maxNote} 字`);

    await resetSession({ signupQuota: null });
    console.error = () => undefined;
    let nulRes: unknown;
    try { nulRes = await submitSignupAction(SLUG, null, form({ buyerEmail: "nul@localhost.test", attendees: [{ name: "王\u0000明" }], note: "備\u0000註" })); } catch (e) { nulRes = { threw: String(e).slice(0, 80) }; }
    console.error = quiet;
    check("姓名／備註含 NUL 字元 → 回友善錯誤，不 throw", !(nulRes && typeof nulRes === "object" && "threw" in (nulRes as object)), JSON.stringify(nulRes));

    await resetSession({ signupQuota: null });
    await submitSignupAction(SLUG, null, form({ buyerEmail: "xss@localhost.test", attendees: [{ name: "<script>alert(1)</script>" }], note: "'; DROP TABLE \"SessionSignupRequest\"; --" }));
    check("HTML／SQL 字樣原樣當成文字存放（資料表仍在、未被執行）", (await rowsOf()).length === 1 && (await rowsOf())[0].name === "<script>alert(1)</script>");
  }

  console.log("\nH. 惡意 slug");
  setIp();
  {
    await resetSession({ signupQuota: null });
    for (const [label, slug] of [["不存在", "no-such-slug"], ["空字串", ""], ["SQL 字樣", "' OR '1'='1"], ["10000 字元", "a".repeat(10_000)], ["大寫（頁面會轉小寫）", SLUG.toUpperCase()]] as const) {
      let r: unknown;
      try { r = await submitSignupAction(slug, null, form({ buyerEmail: "slug@localhost.test" })); } catch (e) { r = { threw: String(e).slice(0, 60) }; }
      const isUpper = label.startsWith("大寫");
      check(`${label} → ${isUpper ? "視同正確 slug（成功）" : "找不到，不 throw"}`, isUpper ? !!r && typeof r === "object" && "success" in (r as object) : !!r && typeof r === "object" && "error" in (r as object), JSON.stringify(r));
    }
  }

  console.log("\nI. 平台金流結帳（PLATFORM）");
  setIp();
  {
    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, signupQuota: 3 });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => createSessionCheckout(SLUG, form({ buyerEmail: `pay${i}@localhost.test`, attendees: [{ name: `付${i}` }] }))));
    const orders = await prisma.sessionSignupOrder.findMany({ where: { sessionId: SID, status: "PENDING" } });
    const seats = orders.reduce((s, o) => s + o.quantity, 0);
    check("名額 3 時，8 人同時結帳，待付款佔位最多 3 席", seats <= 3, `實際佔 ${seats} 席（成功建單 ${rs.filter((r) => r.ok).length} 筆）——超賣 ${Math.max(0, seats - 3)} 席`);

    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, signupQuota: null });
    const same = await Promise.all(Array.from({ length: 5 }, () => createSessionCheckout(SLUG, form({ buyerEmail: "same@localhost.test", attendees: [{ name: "連點付款" }] }))));
    const n = await prisma.sessionSignupOrder.count({ where: { sessionId: SID, buyerEmail: "same@localhost.test" } });
    check("同信箱併發 5 次結帳 → 只建 1 張單（checkoutKey 唯一鍵）", n === 1, `實際 ${n} 張；成功回應 ${same.filter((r) => r.ok).length} 次`);

    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, signupQuota: null });
    const r = await createSessionCheckout(SLUG, form({
      buyerEmail: "tamper@localhost.test",
      attendees: [{ name: "改價甲" }, { name: "改價乙" }],
      extra: { price: "1", total: "1", unitPrice: "1", amount: "1", "attendee-0-retrain": "on", "attendee-1-retrain": "on", status: "PAID" },
    }));
    const o = await prisma.sessionSignupOrder.findFirst({ where: { sessionId: SID, buyerEmail: "tamper@localhost.test" } });
    check("表單塞 price／total／amount／status／自稱複訓 → 一律忽略，金額 = 伺服器算的 2 × 1000", r.ok && o?.total === 2000 && o.status === "PENDING", `total=${o?.total} status=${o?.status}`);
    check("送去金流的金額也是 2000", r.ok && (r as { fields: Record<string, string> }).fields.amount === "2000");

    for (const [label, over] of [["總開關關閉", { isSignupOpen: false }], ["已截止", { signupCloseAt: new Date(Date.now() - DAY) }], ["不是 PLATFORM", { signupPayMode: "MANUAL" }], ["價格為 0", { signupPrice: 0 }]] as const) {
      await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, ...over });
      const rr = await createSessionCheckout(SLUG, form({ buyerEmail: "closed@localhost.test" }));
      check(`${label} → 結帳被拒、零建單`, !rr.ok && (await prisma.sessionSignupOrder.count({ where: { sessionId: SID } })) === 0, JSON.stringify(rr));
    }
    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000 });
    const hp = await createSessionCheckout(SLUG, form({ buyerEmail: "bot2@localhost.test", extra: { hp_extra_note: "x" } }));
    check("蜜罐有值 → 拒絕、零建單", !hp.ok && (await prisma.sessionSignupOrder.count({ where: { sessionId: SID } })) === 0);
  }

  console.log("\nJ. 試算端點被灌入大量聯絡人");
  setIp();
  {
    await prisma.canonicalCourse.create({ data: { id: CC, name: "D層測試標準課程" } });
    await prisma.studentCourseAlias.create({ data: { rawName: RAW, courseId: CC } });
    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, signupRetrainPrice: 800, signupRetrainCourseIds: [CC] });
    const contacts = Array.from({ length: 1500 }, (_, i) => ({ phone: `09${String(20_000_000 + i)}`, email: `c${i}@localhost.test` }));
    const t0 = Date.now();
    const r = await previewSessionPricing(SLUG, contacts);
    const ms = Date.now() - t0;
    check("公開試算端點對超過合理人數（> MAX_ATTENDEES=6）的聯絡人清單應直接拒絕，而不是逐筆查資料庫", !r.ok,
      `回應 ok=${r.ok}，1500 筆聯絡人花 ${ms}ms（每人至少 1 次 DB 查詢，攻擊者可無限放大，沒有任何數量上限）`);
  }

  console.log("\nK. 複訓價（自動新舊生）能否被冒用");
  setIp();
  {
    const vet = await prisma.studentRecord.create({ data: { phone: VET_PHONE, email: VET_EMAIL, name: "老學員" } });
    await prisma.studentCourseHistory.create({ data: { studentId: vet.id, courseName: RAW } });
    await resetSession({ signupPayMode: "PLATFORM", signupPrice: 1000, signupRetrainPrice: 800, signupRetrainCourseIds: [CC], signupQuota: null });
    const totalOf = async (email: string) => (await prisma.sessionSignupOrder.findFirst({ where: { sessionId: SID, buyerEmail: email } }))?.total;
    await createSessionCheckout(SLUG, form({ buyerEmail: "real-vet@localhost.test", attendees: [{ name: "老學員", phone: VET_PHONE }] }));
    check("基準：真正的舊生（姓名、手機相符）→ 複訓價 800", (await totalOf("real-vet@localhost.test")) === 800, String(await totalOf("real-vet@localhost.test")));
    await createSessionCheckout(SLUG, form({ buyerEmail: "new@localhost.test", attendees: [{ name: "新人", phone: phone() }] }));
    check("基準：查無上課紀錄 → 新生價 1000", (await totalOf("new@localhost.test")) === 1000);
    await createSessionCheckout(SLUG, form({ buyerEmail: "fake1@localhost.test", attendees: [{ name: "冒名者", phone: VET_PHONE }] }));
    const t1 = await totalOf("fake1@localhost.test");
    check("姓名完全不同的人填了舊生的手機 → 不享複訓價（Jason 決定：自動比對學員姓名），照新生價 1000", t1 === 1000, `實際 ${t1}`);
    await createSessionCheckout(SLUG, form({ buyerEmail: "fake2@localhost.test", attendees: [{ name: "另一個冒名者", phone: phone(), email: VET_EMAIL }] }));
    const t2 = await totalOf("fake2@localhost.test");
    check("只知道舊生的 Email、手機與姓名都不同 → 不享複訓價，照新生價 1000", t2 === 1000, `實際 ${t2}`);
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
    console.error = quiet;
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
