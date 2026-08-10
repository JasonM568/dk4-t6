import { prisma } from "@/lib/db";
import { boardAuthStatus } from "@/lib/board-auth";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { boardLogoutAction } from "@/actions/board";
import { BoardLoginForm, AutoRefresh } from "./board-client";

export const metadata = { title: "課程報名看板", robots: { index: false } };
// 即時看板：每次請求都撈最新資料（cookies 判斷已使頁面動態化，明示保險）
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const { expiresAt } = await boardAuthStatus();

  if (!expiresAt) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-6">
        <BoardLoginForm />
      </main>
    );
  }

  const [allSessions, allWebinars] = await Promise.all([
    prisma.courseSession.findMany({
      where: { isVisible: true },
      // 最近開課日在前（日期近→遠），沒填日期的排最後
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: {
        signups: {
          orderBy: { orderedAt: "asc" },
          select: { id: true, name: true, product: true },
        },
      },
    }),
    // 進行中講座的索取狀況（講座只收 email，無姓名）
    prisma.webinar.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        endDate: true,
        unpublishAt: true,
        requests: {
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true, name: true },
        },
      },
    }),
  ]);
  // 結束日（場次以 endDate ?? eventDate 為準）過了隔天自動下架；沒填日期 = 永遠顯示
  const sessions = allSessions.filter((s) => !hasEndedInTaipei(s.endDate ?? s.eventDate));
  const now = new Date();
  const webinars = allWebinars.filter(
    (w) => !hasEndedInTaipei(w.endDate) && (!w.unpublishAt || w.unpublishAt > now),
  );
  // 舊生 = 報名複訓方案（1shop 產品名含「複訓」）；其餘為新生
  const isRetrain = (product: string | null) => !!product?.includes("複訓");

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <AutoRefresh />
      <header className="mb-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">📊 課程報名看板</h1>
          <p className="mt-1 text-sm text-gray-500">
            唯讀｜每分鐘自動更新｜資料時間{" "}
            {now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span>
            共 {sessions.length} 場次｜{sessions.reduce((n, s) => n + s.signups.length, 0)} 筆報名
          </span>
          <span>
            {expiresAt.toLocaleString("zh-TW", {
              timeZone: "Asia/Taipei",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}{" "}
            自動登出
          </span>
          <form action={boardLogoutAction}>
            <button className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50">
              登出
            </button>
          </form>
        </div>
      </header>

      {sessions.length === 0 && webinars.length === 0 && (
        <p className="rounded-2xl border border-gray-200 px-6 py-12 text-center text-gray-400">
          目前沒有開放中的場次或講座
        </p>
      )}

      {/* 講座索取狀況（第一順位）：訪客留 email 索取講座連結的名單 */}
      {webinars.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 text-lg font-bold text-gray-700">🎤 講座報名（Email 索取）</h2>
          <div className="space-y-6">
            {webinars.map((w) => (
              <section key={w.id} className="rounded-2xl border border-gray-200 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-bold">{w.title}</h3>
                  <span className="ml-auto rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
                    {w.requests.length} 人索取
                  </span>
                </div>
                {w.requests.length === 0 ? (
                  <p className="text-sm text-gray-400">尚無人索取</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {w.requests.map((r) => (
                      <span
                        key={r.id}
                        className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700"
                      >
                        {r.name ?? r.email}
                        {r.name && (
                          <span className="ml-1 text-xs text-gray-400">{r.email}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && webinars.length > 0 && (
        <h2 className="mb-4 text-lg font-bold text-gray-700">📚 課程場次</h2>
      )}
      <div className="space-y-6">
        {sessions.map((s) => {
          const retrain = s.signups.filter((g) => isRetrain(g.product));
          const fresh = s.signups.length - retrain.length;
          return (
            <section key={s.id} className="rounded-2xl border border-gray-200 p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold">{s.title}</h2>
                {s.eventDate && (
                  <span className="text-sm text-gray-400">
                    {s.eventDate.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-black px-3 py-1 text-sm font-bold text-white">
                    {s.signups.length} 人
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-medium text-emerald-800">
                    新生 {fresh}
                  </span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-800">
                    舊生 {retrain.length}
                  </span>
                </div>
              </div>
              {s.signups.length === 0 ? (
                <p className="text-sm text-gray-400">尚無報名</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {s.signups.map((g) =>
                    isRetrain(g.product) ? (
                      <span
                        key={g.id}
                        className="rounded-full bg-amber-50 px-2.5 py-1 text-sm text-amber-800 ring-1 ring-amber-200"
                      >
                        {g.name}
                        <span className="ml-1 text-xs text-amber-500">複訓</span>
                      </span>
                    ) : (
                      <span
                        key={g.id}
                        className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700"
                      >
                        {g.name}
                      </span>
                    ),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

    </main>
  );
}
