import { prisma } from "@/lib/db";
import { boardAuthStatus } from "@/lib/board-auth";
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

  const sessions = await prisma.courseSession.findMany({
    where: { isVisible: true },
    // 最近開課日在前（日期近→遠），沒填日期的排最後
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      signups: {
        orderBy: { orderedAt: "asc" },
        select: { id: true, name: true, product: true },
      },
    },
  });
  const now = new Date();
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

      {sessions.length === 0 && (
        <p className="rounded-2xl border border-gray-200 px-6 py-12 text-center text-gray-400">
          目前沒有開放中的場次
        </p>
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
