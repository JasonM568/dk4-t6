import type { Prisma } from "@prisma/client";

/**
 * 會員分級制度總開關。
 * false：前台不顯示等級與折扣、結帳一律原價；
 *        後台等級規則設定與 webhook 的消費統計照常運作，重新啟用時資料無缺。
 */
export const TIER_SYSTEM_ENABLED = false;

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

/** 依折扣百分比計算折扣金額（無條件捨去到整數）。
 *  percent 夾在 0–100：DB 端 discountPercent 無 CHECK 約束，若某等級被設成 >100
 *  或負數，折扣金額會超過原價（total 變負）或倒扣。合法 0–100 值行為不變。 */
export function computeDiscount(subtotal: number, discountPercent: number): number {
  const pct = Math.min(100, Math.max(0, discountPercent));
  return Math.floor((subtotal * pct) / 100);
}
