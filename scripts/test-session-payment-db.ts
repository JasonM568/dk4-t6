/* 場次線上金流結算（settleSessionPaidOrder / settleSessionFailedOrder）的驗證。
 * 會寫入資料庫，**只能對本機 localhost 跑**（鐵則：絕不對正式站跑寫入測試）。
 *
 * 驗最危險的幾件事：
 *   ① 付款成功 → 逐位參加者建 SessionSignup 進正式名單、訂單標 PAID、釋放 checkoutKey
 *   ② 冪等：重送的付款通知不重複建名單、不重複計數
 *   ③ 金額不符 / 已取消 → 拒絕結算，不建名單
 *   ④ 付款失敗 → 標 FAILED、釋放 checkoutKey
 * 跑法：npx tsx --conditions=react-server scripts/test-session-payment-db.ts
 * 測完會刪掉自己建的場次、訂單與名單列。 */
import { prisma } from "../src/lib/db";
import {
  settleSessionPaidOrder,
  settleSessionFailedOrder,
} from "../src/lib/payment/session-settle";
import { makeWebOrderNo } from "../src/lib/session-signup-page";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

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

const SID = "test-payment-session";

const ATTENDEES = [
  { name: "測試訂購人", phone: "0912000001", email: "buyer@test.local", meal: "MEAT", isRetrain: false },
  { name: "測試同行者", phone: "0912000002", email: null, meal: "VEG", isRetrain: true },
];

async function cleanup() {
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignupOrder.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
}

async function newOrder(overrides: { total?: number; status?: "PENDING" | "CANCELLED" } = {}) {
  const orderNo = makeWebOrderNo();
  await prisma.sessionSignupOrder.create({
    data: {
      orderNo,
      sessionId: SID,
      checkoutKey: `${SID}:${orderNo}`,
      buyerEmail: "buyer@test.local",
      buyerName: "測試訂購人",
      buyerPhone: "0912000001",
      attendees: ATTENDEES,
      quantity: 2,
      unitPrice: 2940,
      total: overrides.total ?? 5880,
      status: overrides.status ?? "PENDING",
      provider: "payuni",
    },
  });
  return orderNo;
}

async function main() {
  await cleanup();
  await prisma.courseSession.create({
    data: { id: SID, title: "金流結算測試場次", signupPayMode: "PLATFORM", signupPrice: 2940 },
  });

  // ① 付款成功
  {
    const orderNo = await newOrder();
    const res = await settleSessionPaidOrder({ orderNo, amount: 5880, raw: { x: "1" } });
    const order = await prisma.sessionSignupOrder.findUnique({ where: { orderNo } });
    const signups = await prisma.sessionSignup.findMany({ where: { sessionId: SID, orderNo } });
    check("付款成功 → ok（首次結算，非冪等）", res.ok && "already" in res && res.already === false);
    check("訂單標 PAID", order?.status === "PAID", order?.status);
    check("checkoutKey 已釋放", order?.checkoutKey === null);
    check("建立 2 位 SessionSignup", signups.length === 2, `實際 ${signups.length}`);
    check(
      "複訓者 product 標「複訓｜網路報名」",
      signups.some((s) => s.name === "測試同行者" && s.product?.includes("複訓")) &&
        signups.some((s) => s.name === "測試訂購人" && s.product === "網路報名"),
    );

    // ② 冪等：重送不重複建名單
    const res2 = await settleSessionPaidOrder({ orderNo, amount: 5880, raw: { x: "1" } });
    const signups2 = await prisma.sessionSignup.findMany({ where: { sessionId: SID, orderNo } });
    check("重送 → already", res2.ok && "already" in res2 && res2.already === true);
    check("名單仍為 2 位（不重複）", signups2.length === 2, `實際 ${signups2.length}`);
  }

  // ③ 金額不符 → 拒絕
  {
    const orderNo = await newOrder();
    const res = await settleSessionPaidOrder({ orderNo, amount: 1, raw: {} });
    const order = await prisma.sessionSignupOrder.findUnique({ where: { orderNo } });
    const signups = await prisma.sessionSignup.findMany({ where: { sessionId: SID, orderNo } });
    check("金額不符 → 拒絕", !res.ok && "reason" in res && res.reason === "AMOUNT_MISMATCH");
    check("訂單維持 PENDING", order?.status === "PENDING");
    check("不建名單", signups.length === 0);
  }

  // ④ 已取消 → 拒絕結算
  {
    const orderNo = await newOrder({ status: "CANCELLED" });
    const res = await settleSessionPaidOrder({ orderNo, amount: 5880, raw: {} });
    check("已取消訂單 → 拒絕", !res.ok && "reason" in res && res.reason === "CANCELLED");
  }

  // ⑤ 付款失敗 → FAILED、釋放 key
  {
    const orderNo = await newOrder();
    await settleSessionFailedOrder(orderNo, { fail: "1" });
    const order = await prisma.sessionSignupOrder.findUnique({ where: { orderNo } });
    check("失敗 → 標 FAILED", order?.status === "FAILED", order?.status);
    check("失敗 → 釋放 checkoutKey", order?.checkoutKey === null);
  }

  await cleanup();
  console.log(`\n場次金流結算：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
