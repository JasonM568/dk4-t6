/**
 * 付款流程整合測試（不需瀏覽器）
 * 執行：npx tsx scripts/test-purchase-flow.ts
 *
 * 模擬：建立 PENDING 訂單 → 用 ECPay 簽章組 notify → POST 兩次（測冪等）
 * 驗證：訂單轉 PAID、建立 enrollment、totalSpent 只加一次、等級重算。
 */
import { PrismaClient } from "@prisma/client";
import { ecpayCheckMacValue } from "../src/lib/payment/ecpay";

const prisma = new PrismaClient();
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
const HASH_KEY = process.env.ECPAY_HASH_KEY ?? "5294y06JbISpM5x9";
const HASH_IV = process.env.ECPAY_HASH_IV ?? "v77hoKGq4kWxNNIS";

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "user@example.com" },
    include: { currentTier: true },
  });
  const course = await prisma.course.findUniqueOrThrow({
    where: { slug: "design-thinking" }, // 1800
  });

  // 乾淨起點
  await prisma.enrollment.deleteMany({
    where: { userId: user.id, courseId: course.id },
  });

  const spentBefore = user.totalSpent;
  const orderNo = "ITG" + Date.now();
  await prisma.order.create({
    data: {
      orderNo,
      userId: user.id,
      status: "PENDING",
      subtotal: course.price,
      discount: 0,
      total: course.price,
      tierAtOrder: user.currentTier?.level ?? 0,
      items: { create: [{ courseId: course.id, unitPrice: course.price }] },
      payment: { create: { provider: "ecpay", status: "PENDING", amount: course.price } },
    },
  });
  console.log(`建立訂單 ${orderNo}（${course.title} / NT$${course.price}）`);

  // 組 ECPay notify payload
  const payload: Record<string, string> = {
    MerchantID: "2000132",
    MerchantTradeNo: orderNo,
    RtnCode: "1",
    RtnMsg: "交易成功",
    TradeNo: "ITG" + Date.now(),
    TradeAmt: String(course.price),
    PaymentDate: "2026/06/06 12:00:00",
    PaymentType: "Credit_CreditCard",
    PaymentTypeChargeFee: "0",
    TradeDate: "2026/06/06 11:59:00",
    SimulatePaid: "0",
  };
  payload.CheckMacValue = ecpayCheckMacValue(payload, HASH_KEY, HASH_IV);

  async function postNotify(label: string) {
    const res = await fetch(`${BASE}/api/payment/ecpay/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
    });
    console.log(`  ${label} → HTTP ${res.status}, body: "${await res.text()}"`);
  }

  console.log("送出 notify（第 1 次）");
  await postNotify("notify#1");
  console.log("送出 notify（第 2 次，測冪等）");
  await postNotify("notify#2");

  // 驗證
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNo },
    include: { payment: true },
  });
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
  });
  const after = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { currentTier: true },
  });

  console.log("\n=== 驗證結果 ===");
  const checks: [string, boolean, string][] = [
    ["訂單狀態 PAID", order.status === "PAID", order.status],
    ["付款狀態 SUCCESS", order.payment?.status === "SUCCESS", String(order.payment?.status)],
    ["已建立 enrollment", !!enrollment, enrollment ? "yes" : "no"],
    [
      `totalSpent 只加一次 (+${course.price})`,
      after.totalSpent === spentBefore + course.price,
      `${spentBefore} → ${after.totalSpent}`,
    ],
  ];
  let allPass = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "✅" : "❌"} ${name}  [${detail}]`);
    if (!pass) allPass = false;
  }
  console.log(
    `\n目前等級：${after.currentTier?.name ?? "—"}（累積消費 NT$${after.totalSpent}）`,
  );

  if (!allPass) {
    console.error("\n❌ 有檢查未通過");
    process.exit(1);
  }
  console.log("\n✅ 付款流程整合測試全部通過");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
