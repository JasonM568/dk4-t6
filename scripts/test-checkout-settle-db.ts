/* 一般會員結帳／付款結算的 D 層驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * test-guest-checkout-db 已涵蓋「訪客單」的基本冪等與金額比對；這支補的是它沒有碰的：
 *   A. 會員單的正常結算與依序重送
 *   B. 併發：同一張單同時收到多次付款通知（金流商重送＋學員重新整理）→ 只能結算一次
 *   C. 金額竄改：差 1 元、0、負數、NaN、字串 → 全部拒絕且零副作用
 *   D. 惡意 orderNo：SQL injection 字樣、超長字串、空字串 → 不 throw、回 NOT_FOUND
 *   E. 已取消／已退款／已失敗的單不被翻盤
 *   F. 重複付款：同人同課第二張單（ATM 與刷卡各付一次）→ 依序與併發都只能開通一次
 *   G. 防重鍵：同人同課重複下單被 DB 唯一鍵擋下（連點兩次結帳按鈕）
 *   H. 訂單編號併發：同日同課同時下單不會撞號、也不會被擋下
 *   I. total=0（免費／折扣到 0）的單不能靠付款通知白拿課程
 *   J. 折扣計算的邊界（>100%、負數、0 元）
 *
 * 不碰正式 Supabase Auth：全程使用固定測試 uuid，會員單（userId 非 null）不會走建帳號路徑。
 * 跑法：npx tsx --conditions=react-server scripts/test-checkout-settle-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import { Prisma } from "@prisma/client";
import { settlePaidOrder, settleFailedOrder } from "../src/lib/payment/settle";
import { nextOrderNo } from "../src/lib/order-no";
import { computeDiscount } from "../src/lib/membership/tier";

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

const COURSE_ID = "test-co-settle-course";
const COURSE2_ID = "test-co-settle-course2";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
const U3 = "00000000-0000-4000-8000-0000000000a3";
const USERS = [U1, U2, U3];
const EMAIL = "co-settle-test@localhost.test";

async function cleanup() {
  const orders = await prisma.order.findMany({
    where: { OR: [{ userId: { in: USERS } }, { buyerEmail: EMAIL }] },
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  await prisma.enrollment.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { courseId: { in: [COURSE_ID, COURSE2_ID] } }] } });
  await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.memberStats.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE_ID, COURSE2_ID] } } });
}

let seq = 0;
async function newOrder(opts: { userId?: string | null; total?: number; status?: string; courseId?: string; key?: string | null } = {}) {
  const total = opts.total ?? 1000;
  const orderNo = `CS${Date.now().toString().slice(-9)}${String(++seq).padStart(3, "0")}`;
  const userId = opts.userId === undefined ? U1 : opts.userId;
  const courseId = opts.courseId ?? COURSE_ID;
  await prisma.order.create({
    data: {
      orderNo,
      checkoutKey: opts.key === undefined ? `${userId}:${courseId}:${orderNo}` : opts.key,
      userId,
      buyerEmail: EMAIL,
      buyerName: "結算測試",
      buyerPhone: "0912345678",
      status: (opts.status ?? "PENDING") as never,
      subtotal: total,
      discount: 0,
      total,
      items: { create: [{ courseId, unitPrice: total }] },
      payment: { create: { provider: "payuni", status: "PENDING", amount: total } },
    },
  });
  return orderNo;
}

const stats = (u: string) => prisma.memberStats.findUnique({ where: { userId: u } });
const enrollCount = (u: string, c = COURSE_ID) => prisma.enrollment.count({ where: { userId: u, courseId: c } });
const orderOf = (no: string) => prisma.order.findUnique({ where: { orderNo: no } });
const quiet = console.error;

async function main() {
  await cleanup();
  for (const id of [COURSE_ID, COURSE2_ID]) {
    await prisma.course.create({
      data: { id, slug: id, title: `結算測試 ${id}`, description: "測試用，跑完會刪", price: 1000, courseCode: id === COURSE_ID ? "TCS-001" : "TCS-002" },
    });
  }
  console.error = () => undefined; // settle 對異常會 console.error 告警，測試時靜音

  console.log("\nA. 會員單正常結算與依序重送");
  {
    const no = await newOrder({ userId: U1 });
    const r = await settlePaidOrder({ orderNo: no, amount: 1000, raw: { t: "1" } });
    check("結算成功", r.ok && !("already" in r && r.already), JSON.stringify(r));
    check("訂單 PAID、防重鍵釋放", (await orderOf(no))?.status === "PAID" && (await orderOf(no))?.checkoutKey === null);
    check("課程開通 1 筆", (await enrollCount(U1)) === 1);
    check("累計消費 1000、購課數 1", (await stats(U1))?.totalSpent === 1000 && (await stats(U1))?.coursesBought === 1);
    const again = await settlePaidOrder({ orderNo: no, amount: 1000, raw: { t: "2" } });
    check("依序重送 → already", again.ok && "already" in again && again.already === true);
    check("重送後消費與購課數不變", (await stats(U1))?.totalSpent === 1000 && (await stats(U1))?.coursesBought === 1);
  }

  console.log("\nB. 併發：同一張單同時收到 6 次付款通知");
  {
    const no = await newOrder({ userId: U2 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => settlePaidOrder({ orderNo: no, amount: 1000, raw: { t: "c" } }).catch((e) => ({ ok: false as const, reason: `例外:${(e as Error).message.slice(0, 60)}` }))),
    );
    const fresh = results.filter((r) => r.ok && !("already" in r && r.already)).length;
    const st = await stats(U2);
    check("真正執行結算的只有 1 次（其餘都是 already）", fresh === 1, `fresh=${fresh} 結果=${JSON.stringify(results.map((r) => ("already" in r ? (r.already ? "A" : "N") : (r as { reason?: string }).reason ?? "?")))}`);
    check("課程只開通 1 筆", (await enrollCount(U2)) === 1);
    check("累計消費只算一次（1000，不是 6000）", st?.totalSpent === 1000, `totalSpent=${st?.totalSpent}`);
    check("購課數只算一次", st?.coursesBought === 1, `coursesBought=${st?.coursesBought}`);
  }

  console.log("\nC. 金額竄改（零副作用）");
  {
    const cases: [string, number][] = [
      ["少 1 元", 999], ["多 1 元", 1001], ["0 元", 0], ["負數", -1000], ["NaN", NaN], ["小數", 999.99], ["字串轉型", "1000" as unknown as number],
    ];
    for (const [label, amt] of cases) {
      const no = await newOrder({ userId: U3 });
      let res: unknown;
      try {
        res = await settlePaidOrder({ orderNo: no, amount: amt, raw: { t: label } });
      } catch (e) {
        res = { threw: (e as Error).message.slice(0, 60) };
      }
      const o = await orderOf(no);
      const rejected = typeof res === "object" && res !== null && (res as { ok?: boolean }).ok === false && (res as { reason?: string }).reason === "AMOUNT_MISMATCH";
      check(`${label}（${String(amt)}）→ AMOUNT_MISMATCH，訂單仍 PENDING`, rejected && o?.status === "PENDING", JSON.stringify(res));
    }
    check("以上全部沒有開通課程、沒有累計消費", (await enrollCount(U3)) === 0 && (await stats(U3)) === null);
  }

  console.log("\nD. 惡意 orderNo");
  {
    const bad = ["", " ", "' OR '1'='1", "'; DROP TABLE \"Order\"; --", "A".repeat(10_000), "../../etc/passwd", "🍣".repeat(50)];
    for (const no of bad) {
      let res: { ok: boolean; reason?: string } | { threw: string };
      try {
        res = (await settlePaidOrder({ orderNo: no, amount: 1000, raw: {} })) as never;
      } catch (e) {
        res = { threw: (e as Error).message.slice(0, 50) };
      }
      const label = no.length > 20 ? `${no.slice(0, 12)}…(${no.length} 字元)` : JSON.stringify(no);
      check(`orderNo=${label} → NOT_FOUND，不 throw`, "reason" in res && res.reason === "NOT_FOUND", JSON.stringify(res));
    }
    {
      let msg = "";
      try {
        await settlePaidOrder({ orderNo: "\u0000", amount: 1000, raw: {} });
      } catch (e) {
        msg = (e as Error).message;
      }
      check("orderNo 含 NUL → 會 throw（Postgres 22021）。不修：orderNo 來自簽章驗證後的解密內容，外部送不進 NUL",
        /22021|0x00/.test(msg), msg.slice(0, 80) || "沒有 throw（行為變了，請重新評估）");
    }
    check("Order 表仍在（injection 字樣沒有被執行）", (await prisma.order.count()) >= 0);
  }

  console.log("\nE. 已取消／已退款／已失敗不被翻盤");
  {
    const c = await newOrder({ userId: U3, status: "CANCELLED", key: null });
    const rc = await settlePaidOrder({ orderNo: c, amount: 1000, raw: {} });
    check("CANCELLED 收到付款 → CANCELLED，不開通", !rc.ok && rc.reason === "CANCELLED" && (await enrollCount(U3)) === 0, JSON.stringify(rc));
    const rf = await newOrder({ userId: U3, status: "REFUNDED", key: null });
    const rr = await settlePaidOrder({ orderNo: rf, amount: 1000, raw: {} });
    check("REFUNDED 收到付款 → already，狀態不變、不重新開通", rr.ok && "already" in rr && rr.already && (await orderOf(rf))?.status === "REFUNDED" && (await enrollCount(U3)) === 0);
    const f = await newOrder({ userId: U3 });
    await settleFailedOrder(f, { why: "card declined" });
    const fo = await orderOf(f);
    check("付款失敗通知 → FAILED 並釋放防重鍵", fo?.status === "FAILED" && fo.checkoutKey === null);
    const paid = await newOrder({ userId: U3, key: null });
    await settlePaidOrder({ orderNo: paid, amount: 1000, raw: {} });
    await prisma.enrollment.deleteMany({ where: { userId: U3 } });
    await prisma.memberStats.deleteMany({ where: { userId: U3 } });
    await settleFailedOrder(paid, { why: "late failure" });
    check("已付款的單收到遲到的失敗通知 → 不翻盤", (await orderOf(paid))?.status === "PAID");
  }

  console.log("\nF. 重複付款（同人同課兩張單）");
  {
    await prisma.enrollment.deleteMany({ where: { userId: U1 } });
    await prisma.memberStats.deleteMany({ where: { userId: U1 } });
    const first = await newOrder({ userId: U1, courseId: COURSE2_ID, key: null });
    const second = await newOrder({ userId: U1, courseId: COURSE2_ID, key: null });
    await settlePaidOrder({ orderNo: first, amount: 1000, raw: {} });
    const dup = await settlePaidOrder({ orderNo: second, amount: 1000, raw: {} });
    check("依序：第二張 → DUPLICATE_PAID", !dup.ok && dup.reason === "DUPLICATE_PAID", JSON.stringify(dup));
    check("第二張仍 PENDING、累計只算一次", (await orderOf(second))?.status === "PENDING" && (await stats(U1))?.totalSpent === 1000);
    const pay = await prisma.payment.findFirst({ where: { order: { orderNo: second } } });
    check("重複付款留痕 _needsRefund", (pay?.rawCallback as Record<string, unknown> | null)?._needsRefund === true);

    // 併發版：ATM 與信用卡的通知幾乎同時到
    await prisma.enrollment.deleteMany({ where: { userId: U2 } });
    await prisma.memberStats.deleteMany({ where: { userId: U2 } });
    const a = await newOrder({ userId: U2, courseId: COURSE2_ID, key: null });
    const b = await newOrder({ userId: U2, courseId: COURSE2_ID, key: null });
    const rs = await Promise.all([
      settlePaidOrder({ orderNo: a, amount: 1000, raw: {} }).catch((e) => ({ ok: false as const, reason: `例外:${(e as Error).message.slice(0, 50)}` })),
      settlePaidOrder({ orderNo: b, amount: 1000, raw: {} }).catch((e) => ({ ok: false as const, reason: `例外:${(e as Error).message.slice(0, 50)}` })),
    ]);
    const paidCount = await prisma.order.count({ where: { orderNo: { in: [a, b] }, status: "PAID" } });
    const st = await stats(U2);
    check("併發：兩張同課的單只能有 1 張被結算為 PAID", paidCount === 1, `PAID=${paidCount} 結果=${JSON.stringify(rs)}`);
    check("併發：累計消費只算一次（1000）", st?.totalSpent === 1000, `totalSpent=${st?.totalSpent}`);
  }

  console.log("\nG. 防重鍵（連點兩次結帳）");
  {
    const key = `${U3}:${COURSE_ID}`;
    await newOrder({ userId: U3, key });
    let code = "";
    try {
      await newOrder({ userId: U3, key });
    } catch (e) {
      code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e).slice(0, 40);
    }
    check("同人同課第二張待付款單被唯一鍵擋下（P2002）", code === "P2002", code);
    await prisma.order.updateMany({ where: { checkoutKey: key }, data: { status: "EXPIRED", checkoutKey: null } });
    let ok = true;
    try {
      await newOrder({ userId: U3, key });
    } catch {
      ok = false;
    }
    check("舊單失效釋放鍵後可以重新下單", ok);
  }

  console.log("\nH. 訂單編號併發（直接呼叫 src/lib/order-create.ts 的 createOrderWithRetry）");
  {
    const { createOrderWithRetry, ORDER_NO_MAX_ATTEMPTS } = await import("../src/lib/order-create");
    const course = { courseCode: "TCS-001", slug: COURSE_ID };
    const mkOrder = (orderNo: string, checkoutKey: string) =>
      prisma.order.create({
        data: {
          orderNo, checkoutKey, userId: null, buyerEmail: EMAIL, buyerName: "併發",
          buyerPhone: "0912345678", status: "PENDING", subtotal: 1, discount: 0, total: 1,
          items: { create: [{ courseId: COURSE_ID, unitPrice: 1 }] },
          payment: { create: { provider: "payuni", status: "PENDING", amount: 1 } },
        },
        select: { id: true },
      });
    check("重試上限為 8 次", ORDER_NO_MAX_ATTEMPTS === 8, String(ORDER_NO_MAX_ATTEMPTS));
    for (const N of [5, 8]) {
      const rs = await Promise.all(Array.from({ length: N }, (_, i) => createOrderWithRetry(course, (no) => mkOrder(no, `race${N}:${i}:${Date.now()}`))));
      const ok = rs.filter((r) => r.ok) as { ok: true; orderNo: string }[];
      check(`${N} 筆同時下單全部成功（沒有人被「系統忙碌」擋下）`, ok.length === N, `成功 ${ok.length}/${N}`);
      check(`${N} 筆的訂單編號互不重複`, new Set(ok.map((r) => r.orderNo)).size === ok.length);
    }
    {
      const key = `dupkey:${Date.now()}`;
      await createOrderWithRetry(course, (no) => mkOrder(no, key));
      let calls = 0;
      let keyErrAt = -1;
      let code = "";
      let target = "";
      try {
        await createOrderWithRetry(course, async (no) => {
          calls++;
          try {
            return await mkOrder(no, key);
          } catch (e) {
            const t = e instanceof Prisma.PrismaClientKnownRequestError ? String((e.meta as { target?: unknown } | undefined)?.target ?? "") : "";
            if (/checkoutKey/.test(t) && !/orderNo/.test(t)) keyErrAt = calls;
            throw e;
          }
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
          code = e.code;
          target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
        }
      }
      check("checkoutKey 撞鍵（重複下單）不被當撞號吞掉：直接拋出 P2002", code === "P2002" && /checkoutKey/.test(target), `code=${code} target=${target}`);
      // 前面可能先遇到真正的 orderNo 撞號（count 式取號在有缺號時會撞），那些重試是對的；
      // 重點是『第一次遇到 checkoutKey 撞鍵之後』不能再呼叫 build。
      check("遇到 checkoutKey 撞鍵後立刻停止，不再重試", keyErrAt > 0 && calls === keyErrAt, `calls=${calls} keyErrAt=${keyErrAt}`);
    }
    {
      let calls = 0;
      let msg = "";
      try {
        await createOrderWithRetry(course, async () => {
          calls++;
          throw new Error("boom");
        });
      } catch (e) {
        msg = (e as Error).message;
      }
      check("其他錯誤原樣拋出、不重試", msg === "boom" && calls === 1, `msg=${msg} calls=${calls}`);
    }
    {
      let calls = 0;
      const t0 = Date.now();
      const r = await createOrderWithRetry(course, async () => {
        calls++;
        throw new Prisma.PrismaClientKnownRequestError("orderNo taken", { code: "P2002", clientVersion: "test", meta: { target: ["orderNo"] } });
      });
      const ms = Date.now() - t0;
      check("orderNo 一直撞 → 試滿 8 次後回 {ok:false}", r.ok === false && calls === 8, `ok=${r.ok} calls=${calls}`);
      check("重試之間有退避（8 次至少約 7×20ms）", ms >= 7 * 20, `${ms}ms`);
    }
    {
      // 傳 opts.generate：訂單編號就是 generate 的值，且完全不呼叫 nextOrderNo（不查 Order.count）
      const trap = new Proxy({}, { get() { throw new Error("nextOrderNo 不該被呼叫：不能讀 course 欄位"); } }) as { courseCode?: string; slug?: string };
      const tag = `GEN${Date.now().toString().slice(-8)}`;
      const r = await createOrderWithRetry(trap, (no) => mkOrder(no, `gen:${tag}`), { generate: () => `${tag}A` });
      check("opts.generate：回傳的 orderNo 就是 generate 的值", r.ok && r.orderNo === `${tag}A`, JSON.stringify(r));
      check("opts.generate：沒有呼叫 nextOrderNo（course 欄位完全沒被讀取）", r.ok);
      const seen: number[] = [];
      const r2 = await createOrderWithRetry(trap, (no) => mkOrder(no, `gen2:${tag}:${no}`), {
        generate: (attempt) => {
          seen.push(attempt);
          return attempt < 2 ? `${tag}A` : `${tag}B`; // 前兩次撞到已存在的單號，第三次換新號
        },
      });
      check("opts.generate：撞號時以 attempt 0,1,2 重新呼叫 generate，第三次成功", r2.ok && r2.orderNo === `${tag}B` && JSON.stringify(seen) === "[0,1,2]", `seen=${JSON.stringify(seen)} ${JSON.stringify(r2)}`);
    }
  }

  console.log("\nI. total=0 的單不能靠付款通知白拿課程");
  {
    await prisma.enrollment.deleteMany({ where: { userId: U3 } });
    await prisma.memberStats.deleteMany({ where: { userId: U3 } });
    const z = await newOrder({ userId: U3, total: 0, courseId: COURSE2_ID, key: null });
    let res: unknown;
    try {
      res = await settlePaidOrder({ orderNo: z, amount: 0, raw: { t: "zero" } });
    } catch (e) {
      res = { threw: (e as Error).message.slice(0, 60) };
    }
    const enrolled = await enrollCount(U3, COURSE2_ID);
    check("total=0 的單收到 amount=0 的『付款成功』→ 不應開通課程（防禦縱深：結帳端已擋，結算端也該擋）",
      enrolled === 0, `結果=${JSON.stringify(res)}，開通 ${enrolled} 筆，訂單狀態=${(await orderOf(z))?.status}`);
  }

  console.log("\nJ. 折扣計算邊界");
  {
    check("0% → 0", computeDiscount(1000, 0) === 0);
    check("100% → 全額（total 為 0，結帳端必須擋）", computeDiscount(1000, 100) === 1000);
    check(">100%（120）夾到 100%，折扣不超過原價", computeDiscount(1000, 120) === 1000);
    check("負折扣夾到 0%，不會倒扣變加價", computeDiscount(1000, -20) === 0);
    check("原價 0 元 → 折扣 0", computeDiscount(0, 50) === 0);
    check("無條件捨去且為整數（999 元 33% → 329）", computeDiscount(999, 33) === 329 && Number.isInteger(computeDiscount(999, 33)));
    check("折扣後金額永遠 ≥ 0", [0, 1, 33, 99, 100, 150, -5].every((p) => 777 - computeDiscount(777, p) >= 0));
  }

  console.error = quiet;
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
