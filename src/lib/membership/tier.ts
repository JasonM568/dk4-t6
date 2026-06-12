import type { Prisma } from "@prisma/client";

/**
 * 依會員目前的累積消費 / 購課數（MemberStats），重算並更新會員等級。
 * 在付款成功 webhook 的同一個 transaction 內呼叫。
 */
export async function recalcTier(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const stats = await tx.memberStats.findUnique({ where: { userId } });
  if (!stats) return;

  const tiers = await tx.membershipTier.findMany({
    orderBy: { level: "desc" },
  });

  // 找出「同時符合消費門檻與購課數門檻」的最高等級
  const matched = tiers.find(
    (t) =>
      stats.totalSpent >= t.minTotalSpent &&
      stats.coursesBought >= t.minCoursesBought,
  );

  if (matched && matched.id !== stats.currentTierId) {
    await tx.memberStats.update({
      where: { userId },
      data: { currentTierId: matched.id },
    });
  }
}

/** 依折扣百分比計算折扣金額（無條件捨去到整數）*/
export function computeDiscount(subtotal: number, discountPercent: number): number {
  return Math.floor((subtotal * discountPercent) / 100);
}
