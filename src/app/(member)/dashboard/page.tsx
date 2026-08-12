import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { formatNT } from "@/lib/format";
import { TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { getMemberProfile } from "@/lib/member-profile";
import { claimStudentRecord } from "@/lib/student-history";

export const metadata = { title: "會員中心" };

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // MemberStats 是 lazy upsert（首次付款成功才建立），新會員可能還沒有 → 用預設值
  const [stats, orderCount, memberProfile] = await Promise.all([
    prisma.memberStats.findUnique({
      where: { userId: user.id },
      include: { currentTier: true },
    }),
    prisma.order.count({ where: { userId: user.id } }),
    getMemberProfile(user.id),
  ]);

  // 歷史上課紀錄只認「已認領到本帳號」的那筆——共用信箱（夫妻／親子）若用 email 比對，
  // 會把另一半的上課紀錄顯示在自己頁面上。註冊當下已認領過；這裡再補一次是為了
  // 既有會員（先前沒手機、或註冊後才補填手機）。認領失敗不擋頁面。
  await claimStudentRecord(user.id, { email: user.email, phone: memberProfile?.phone }).catch(
    (e) => console.error("[dashboard] 歷史學員資料認領失敗", e),
  );
  const studentRecord = await prisma.studentRecord.findFirst({
    where: { claimedUserId: user.id },
    include: { histories: { orderBy: { attendedAt: "desc" } } },
  });

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

      {studentRecord?.histories.length ? <section className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/40 p-5"><h2 className="font-bold">📖 我的歷史上課記錄</h2><ul className="mt-3 space-y-2 text-sm">{studentRecord.histories.map(h=><li key={h.id}>{h.courseName}{h.attendedAt?` · ${h.attendedAt.toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})}`:""}</li>)}</ul></section> : null}

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
        <Link
          href="/dashboard/profile"
          className="flex-1 rounded-xl border border-gray-200 p-4 text-center font-medium transition hover:bg-gray-50"
        >
          👤 會員資料
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
