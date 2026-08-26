import { prisma } from "@/lib/db";
import { liveAuthSession } from "@/lib/live-auth";
import { liveLogoutAction } from "@/actions/live";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { buildJoinUrl, isSafeHttpUrl } from "@/lib/meeting";
import { buildContentHtml } from "@/lib/email/render-content";
import { LiveLoginForm, CopyButton } from "./live-form";

export const metadata = {
  title: "線上上課資訊",
  // 這頁的內容是憑碼才看得到的上課連結，不該進搜尋引擎
  robots: { index: false, follow: false },
};
// 憑碼內容：每次請求都重新驗 cookie 與撈最新連結（管理員改連結要立即生效）
export const dynamic = "force-dynamic";

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

export default async function LivePage() {
  const auth = await liveAuthSession();

  if (!auth) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-6">
        <LiveLoginForm />
      </main>
    );
  }

  const session = await prisma.courseSession.findUnique({
    where: { id: auth.sessionId },
    select: {
      title: true,
      eventDate: true,
      endDate: true,
      accessCode: true,
      meetingUrl: true,
      meetingId: true,
      meetingPassword: true,
      meetingInfo: true,
    },
  });

  // 通過 cookie 之後場次才被刪／清掉連結／結束：一律退回輸入畫面，
  // 不留一頁「已失效但還顯示著連結」的殘影
  const ended = !session || hasEndedInTaipei(session.endDate ?? session.eventDate);
  if (!session || !session.accessCode || !session.meetingUrl || ended) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-gray-500">
          這堂課的上課資訊已關閉（課程已結束或連結已撤下）。
        </p>
        <form action={liveLogoutAction}>
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm transition hover:bg-gray-50">
            輸入其他查看碼
          </button>
        </form>
      </main>
    );
  }

  const joinUrl = buildJoinUrl(session.meetingUrl, session.meetingPassword);
  // 後台自由輸入的網址，渲染成 <a href> 前先擋掉 javascript:／data: 這類 scheme
  const joinable = isSafeHttpUrl(joinUrl);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <header className="mb-6">
        <p className="text-sm text-gray-400">線上上課資訊</p>
        <h1 className="mt-1 text-2xl font-bold">{session.title}</h1>
        {session.eventDate && (
          <p className="mt-1 text-sm text-gray-500">
            上課日期：
            {session.eventDate.toLocaleDateString("zh-TW", TPE)}
            {session.endDate &&
              session.endDate.getTime() !== session.eventDate.getTime() &&
              ` – ${session.endDate.toLocaleDateString("zh-TW", TPE)}`}
          </p>
        )}
      </header>

      {joinable ? (
        <a
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-2xl bg-red-600 px-6 py-4 text-center text-lg font-bold text-white transition hover:bg-red-700"
        >
          進入線上教室
        </a>
      ) : (
        // 網址壞掉時不做成可點連結，但仍把原文顯示出來讓學員能自行複製、也讓客服看得出問題
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-6 py-4 text-sm text-amber-800">
          上課連結格式有誤，請聯繫客服。
          <span className="mt-1 block break-all font-mono text-xs">
            {session.meetingUrl}
          </span>
        </div>
      )}

      {/* 手機點連結有時會被 App 攔截或開不起來，備援：手動輸入會議 ID／密碼 */}
      {(session.meetingId || session.meetingPassword) && (
        <dl className="mt-4 space-y-2 rounded-2xl border border-gray-200 px-5 py-4 text-sm">
          {session.meetingId && (
            <div className="flex items-center gap-2">
              <dt className="w-20 shrink-0 text-gray-500">會議 ID</dt>
              <dd className="font-mono break-all">{session.meetingId}</dd>
              <CopyButton value={session.meetingId} label="會議 ID" />
            </div>
          )}
          {session.meetingPassword && (
            <div className="flex items-center gap-2">
              <dt className="w-20 shrink-0 text-gray-500">密碼</dt>
              <dd className="font-mono break-all">{session.meetingPassword}</dd>
              <CopyButton value={session.meetingPassword} label="密碼" />
            </div>
          )}
          <p className="pt-1 text-xs text-gray-400">
            按鈕開不起來時，可在 Zoom App 選「加入會議」後手動輸入。
          </p>
        </dl>
      )}

      {session.meetingInfo && (
        <section className="mt-4 rounded-2xl border border-gray-200 px-5 py-4">
          <h2 className="mb-2 text-sm font-medium text-gray-500">課程資料與注意事項</h2>
          <div
            className="text-sm leading-relaxed [&_a]:text-indigo-600 [&_a]:underline"
            // 與寄信同一條防注入路徑：buildContentHtml 內部 esc() 轉義後才組 HTML
            dangerouslySetInnerHTML={{ __html: buildContentHtml(session.meetingInfo) }}
          />
        </section>
      )}

      <footer className="mt-8 flex items-center justify-between text-xs text-gray-400">
        <span>
          {auth.expiresAt.toLocaleString("zh-TW", {
            timeZone: "Asia/Taipei",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}{" "}
          後需重新輸入查看碼
        </span>
        <form action={liveLogoutAction}>
          <button className="rounded-lg border border-gray-300 px-2.5 py-1 transition hover:bg-gray-50">
            輸入其他查看碼
          </button>
        </form>
      </footer>
    </main>
  );
}
