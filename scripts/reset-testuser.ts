import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "user@example.com" } });
  const bronze = await prisma.membershipTier.findUniqueOrThrow({ where: { level: 0 } });
  await prisma.enrollment.deleteMany({ where: { userId: user.id } });
  const orders = await prisma.order.findMany({ where: { userId: user.id }, select: { id: true } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders.map(o => o.id) } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orders.map(o => o.id) } } });
  await prisma.order.deleteMany({ where: { userId: user.id } });
  await prisma.user.update({ where: { id: user.id }, data: { totalSpent: 0, coursesBought: 0, currentTierId: bronze.id } });
  console.log("✅ 測試會員 user@example.com 已重置為銅卡、消費 0、無訂單");
}
main().finally(() => prisma.$disconnect());
