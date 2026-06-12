import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { formatNT } from "@/lib/format";
import { TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";

export const metadata = { title: "會員中心" };

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // MemberStats 是 lazy upsert（首次付款成功才建立），新會員可能還沒有 → 用預設值
  const [stats, orderCount] = await Promise.all([
    prisma.memberStats.findUnique({
      where: { userId: user.id },
      include: { currentTier: true },
    }),
    prisma.order.count({ where: { userId: user.id } }),
  ]);

  const totalSpent = stats?.totalSpent ?? 0;
  const coursesBought = stats?.coursesBought ?? 0;
  const currentTier = stats?.currentTier ?? null;

  // 下一個等級門檻
  const tiers = await prisma.membershipTier.findMany({
    orderBy: { level: "asc" },
  });
  const currentLevel = currentTier?.level ?? 0;
  const nextTier = tiers.find((t) => t.level > currentLevel);
  const remaining = nextTier
    ? Math.max(0, nextTier.minTotalSpent - totalSpent)
    : 0;
  const progress = nextTier
    ? Math.min(100, Math.round((totalSpent / nextTier.minTotalSpent) * 100))
    : 100;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold">會員中心</h1>

      {/* 等級卡（分級制度停用時改顯示簡潔歡迎卡） */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 p-6 text-white">
        {TIER_SYSTEM_ENABLED ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm opacity-80">
                  {user.displayName ?? user.email}
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {currentTier?.name ?? "一般會員"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm opacity-80">目前折扣</div>
                <div className="text-2xl font-bold">
                  {currentTier?.discountPercent
                    ? `${100 - currentTier.discountPercent} 折`
                    : "無"}
                </div>
              </div>
            </div>

            {nextTier ? (
              <div className="mt-6">
                <div className="mb-1 flex justify-between text-xs opacity-90">
                  <span>距離「{nextTier.name}」</span>
                  <span>還差 {formatNT(remaining)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full bg-white"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 text-sm opacity-90">
                🎉 你已是最高等級會員！
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="text-sm opacity-80">歡迎回來</div>
            <div className="mt-1 text-2xl font-bold">
              {user.displayName ?? user.email}
            </div>
          </div>
        )}
      </div>

      {/* 統計 */}
      <div
        className={`mt-6 grid gap-4 ${TIER_SYSTEM_ENABLED ? "grid-cols-3" : "grid-cols-2"}`}
      >
        {TIER_SYSTEM_ENABLED && (
          <Stat label="累積消費" value={formatNT(totalSpent)} />
        )}
        <Stat label="購買課程" value={`${coursesBought} 門`} />
        <Stat label="訂單數" value={`${orderCount} 筆`} />
      </div>

      {/* 快速連結 */}
      <div className="mt-6 flex gap-4">
        <Link
          href="/my-courses"
          className="flex-1 rounded-xl border border-gray-200 p-4 text-center font-medium transition hover:bg-gray-50"
        >
          📚 我的課程
        </Link>
        <Link
          href="/orders"
          className="flex-1 rounded-xl border border-gray-200 p-4 text-center font-medium transition hover:bg-gray-50"
        >
          🧾 訂單管理
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
