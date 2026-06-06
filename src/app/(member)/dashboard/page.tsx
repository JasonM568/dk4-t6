import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatNT } from "@/lib/format";

export const metadata = { title: "會員中心" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      currentTier: true,
      _count: { select: { enrollments: true, orders: true } },
    },
  });
  if (!user) redirect("/login");

  // 下一個等級門檻
  const tiers = await prisma.membershipTier.findMany({
    orderBy: { level: "asc" },
  });
  const currentLevel = user.currentTier?.level ?? 0;
  const nextTier = tiers.find((t) => t.level > currentLevel);
  const remaining = nextTier
    ? Math.max(0, nextTier.minTotalSpent - user.totalSpent)
    : 0;
  const progress = nextTier
    ? Math.min(100, Math.round((user.totalSpent / nextTier.minTotalSpent) * 100))
    : 100;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold">會員中心</h1>

      {/* 等級卡 */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-80">{user.name ?? user.email}</div>
            <div className="mt-1 text-2xl font-bold">
              {user.currentTier?.name ?? "一般會員"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm opacity-80">目前折扣</div>
            <div className="text-2xl font-bold">
              {user.currentTier?.discountPercent
                ? `${100 - user.currentTier.discountPercent} 折`
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
          <div className="mt-6 text-sm opacity-90">🎉 你已是最高等級會員！</div>
        )}
      </div>

      {/* 統計 */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="累積消費" value={formatNT(user.totalSpent)} />
        <Stat label="購買課程" value={`${user.coursesBought} 門`} />
        <Stat label="訂單數" value={`${user._count.orders} 筆`} />
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
