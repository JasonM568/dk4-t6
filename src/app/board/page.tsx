import { prisma } from "@/lib/db";
import { boardAuthStatus } from "@/lib/board-auth";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { boardLogoutAction } from "@/actions/board";
import { BoardLoginForm, AutoRefresh } from "./board-client";
import { BoardRoster } from "./board-roster";

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
          // 已延期到其他場次的不列（對方場次會有新列）
          where: { deferredToSessionId: null },
          orderBy: { orderedAt: "asc" },
          // 只給看板需要的最小欄位——刻意不含電話/信箱
          select: {
            id: true, name: true, product: true, isRetrain: true,
            meal: true, groupNo: true, isStaff: true,
          },
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
  const webinars = allWebinars
    .filter((w) => !hasEndedInTaipei(w.endDate) && (!w.unpublishAt || w.unpublishAt > now))
    .map((w) => ({ id: w.id, title: w.title, requests: w.requests }));
  // 日期在 server 端就格式化成台北時間字串，避免丟 Date 給 client 後時區/水合不一致
  const boardSessions = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    dateLabel:
      s.eventDate?.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) ?? null,
    signups: s.signups,
  }));

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
      {sessions.length === 0 && webinars.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 px-6 py-12 text-center text-gray-400">
          目前沒有開放中的場次或講座
        </p>
      ) : (
        <BoardRoster sessions={boardSessions} webinars={webinars} />
      )}
    </main>
  );
}
