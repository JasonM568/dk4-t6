import type { Prisma } from "@prisma/client";

/**
 * 依使用者目前的累積消費 / 購課數，重算並更新會員等級。
 * 在付款成功 webhook 的同一個 transaction 內呼叫。
 */
export async function recalcTier(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const tiers = await tx.membershipTier.findMany({
    orderBy: { level: "desc" },
  });

  // 找出「同時符合消費門檻與購課數門檻」的最高等級
  const matched = tiers.find(
    (t) =>
      user.totalSpent >= t.minTotalSpent &&
      user.coursesBought >= t.minCoursesBought,
  );

  if (matched && matched.id !== user.currentTierId) {
    await tx.user.update({
      where: { id: userId },
      data: { currentTierId: matched.id },
    });
  }
}

/** 依折扣百分比計算折扣金額（無條件捨去到整數）*/
export function computeDiscount(subtotal: number, discountPercent: number): number {
  return Math.floor((subtotal * discountPercent) / 100);
}
