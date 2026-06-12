/**
 * 重置測試會員資料
 * 執行：npx tsx scripts/reset-testuser.ts
 *
 * 會員帳號在 Supabase Auth，本機 DB 只有統計與訂單資料——
 * 以固定測試 uuid 清空 enrollment / order，並把 MemberStats 重置為銅卡。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 固定測試用 uuid（須與 prisma/seed.ts 的 TEST_USER_ID 一致；
// seed.ts 匯入即執行 main()，故不直接 import）
const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const bronze = await prisma.membershipTier.findUniqueOrThrow({ where: { level: 0 } });

  await prisma.enrollment.deleteMany({ where: { userId: TEST_USER_ID } });
  const orders = await prisma.order.findMany({ where: { userId: TEST_USER_ID }, select: { id: true } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders.map(o => o.id) } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orders.map(o => o.id) } } });
  await prisma.order.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.memberStats.upsert({
    where: { userId: TEST_USER_ID },
    update: { totalSpent: 0, coursesBought: 0, currentTierId: bronze.id },
    create: { userId: TEST_USER_ID, totalSpent: 0, coursesBought: 0, currentTierId: bronze.id },
  });
  console.log(`✅ 測試會員 ${TEST_USER_ID} 已重置為銅卡、消費 0、無訂單`);
}

main().finally(() => prisma.$disconnect());
