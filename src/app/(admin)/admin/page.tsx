import Link from "next/link";
import { prisma } from "@/lib/db";
import { countProfiles } from "@/lib/supabase/admin";
import { formatNT, formatDate } from "@/lib/format";
import { isRetrainProduct } from "@/lib/session-roster";

export const metadata = { title: "後台總覽" };

export default async function AdminDashboard() {
  // 會員人數改數 Supabase public.profiles（唯讀）；其餘統計仍在 course schema
  const [
    courseCount,
    userCount,
    paidOrders,
    revenue,
    sessions,
    recentSignups,
    webinars,
    recentRequests,
  ] = await Promise.all([
    prisma.course.count(),
    countProfiles(),
    prisma.order.count({ where: { status: "PAID" } }),
    prisma.order.aggregate({
      where: { status: "PAID" },
      _sum: { total: true },
    }),
    // 場次動態：看板顯示中的場次與人數
    prisma.courseSession.findMany({
      where: { isVisible: true },
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        eventDate: true,
        _count: { select: { signups: true } },
      },
    }),
    // 最近 8 筆場次報名（依匯入時間，最新在前）
    prisma.sessionSignup.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        product: true,
        createdAt: true,
        session: { select: { title: true } },
      },
    }),
    // 講座動態：開放中講座與索取人數
    prisma.webinar.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        _count: { select: { requests: true } },
      },
    }),
    // 最近 8 筆講座索取
    prisma.webinarRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        webinar: { select: { title: true } },
      },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">營運總覽</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="課程總數" value={`${courseCount}`} />
        <Card label="會員人數" value={`${userCount}`} />
        <Card label="成交訂單" value={`${paidOrders}`} />
        <Card label="總營收" value={formatNT(revenue._sum.total ?? 0)} />
      </div>

      {/* 場次 / 講座報名動態 */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {/* 場次動態 */}
        <section className="rounded-xl border border-gray-200 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">📚 場次報名動態</h2>
            <Link href="/admin/sessions" className="text-sm text-indigo-600 underline">
              管理場次
            </Link>
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-400">目前沒有看板顯示中的場次</p>
          ) : (
            <div className="mb-3 space-y-1.5">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {s.title}
                    {s.eventDate && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        {s.eventDate.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}
                      </span>
                    )}
                  </span>
                  <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold">
                    {s._count.signups} 人
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentSignups.length > 0 && (
            <>
              <div className="mb-1.5 border-t border-gray-100 pt-2 text-xs text-gray-400">
                最近報名
              </div>
              <ul className="space-y-1 text-sm text-gray-600">
                {recentSignups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {g.name}
                      {isRetrainProduct(g.product) && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">
                          複訓
                        </span>
                      )}
                      <span className="ml-1.5 text-xs text-gray-400">{g.session.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {formatDate(g.createdAt.toISOString())}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* 講座動態 */}
        <section className="rounded-xl border border-gray-200 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">🎤 講座報名動態</h2>
            <Link href="/admin/webinars" className="text-sm text-indigo-600 underline">
              管理講座
            </Link>
          </div>
          {webinars.length === 0 ? (
            <p className="text-sm text-gray-400">目前沒有開放中的講座</p>
          ) : (
            <div className="mb-3 space-y-1.5">
              {webinars.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {w.title}
                    <span className="ml-1.5 font-mono text-xs text-gray-400">
                      /webinar/{w.slug}
                    </span>
                  </span>
                  <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold">
                    {w._count.requests} 人索取
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentRequests.length > 0 && (
            <>
              <div className="mb-1.5 border-t border-gray-100 pt-2 text-xs text-gray-400">
                最近索取
              </div>
              <ul className="space-y-1 text-sm text-gray-600">
                {recentRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {r.name ?? r.email}
                      {r.name && (
                        <span className="ml-1.5 text-xs text-gray-400">{r.email}</span>
                      )}
                      <span className="ml-1.5 text-xs text-gray-400">{r.webinar.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {formatDate(r.createdAt.toISOString())}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}
