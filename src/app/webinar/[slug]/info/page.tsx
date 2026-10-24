import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { WEALTH5_CHECK_PATH, WEALTH5_CHECK_SLUG } from "@/lib/wealth5-check";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { buildJoinUrl, isSafeHttpUrl } from "@/lib/meeting";

// 活動資訊頁：報名頁（/webinar/[slug]）的姊妹頁，訪客填完表單可點進來，也可直接轉傳。
// 放 DM、說明、完整會議資訊（連結／ID／密碼／補充資訊）——2026-10-24 Jason 拍板：這頁**公開**，
// 拿到網址的人不填表也能進會議；填表是為了收到確認信備用，不是進場門票。
export const dynamic = "force-dynamic";

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** 補充資訊常整段貼 Zoom 邀請：把文字裡的 http(s) 網址變成可點的連結，其餘原樣輸出。
 *  只放行 isSafeHttpUrl 過的網址（擋 javascript:／data:），不合法的留純文字。 */
function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 1 && isSafeHttpUrl(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-indigo-600 underline">
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const digitsOnly = (s: string) => s.replace(/\D/g, "");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { slug }, select: { title: true } });
  return { title: webinar ? `${webinar.title} — 活動資訊` : "活動資訊" };
}

export default async function WebinarInfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === WEALTH5_CHECK_SLUG) redirect(WEALTH5_CHECK_PATH);
  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      lectureUrl: true,
      meetingId: true,
      meetingPassword: true,
      meetingInfo: true,
      dmImage: true,
      kind: true,
      isActive: true,
      endDate: true,
      unpublishAt: true,
    },
  });
  if (!webinar) notFound();
  const isResource = webinar.kind === "RESOURCE";
  const open =
    webinar.isActive &&
    !hasEndedInTaipei(webinar.endDate) &&
    (!webinar.unpublishAt || webinar.unpublishAt > new Date());

  // 會議連結：與信件同一條（有密碼就帶 ?pwd=）；素材索取頁沒有「進會議」這件事
  const joinUrl = !isResource && isSafeHttpUrl(webinar.lectureUrl)
    ? buildJoinUrl(webinar.lectureUrl, webinar.meetingPassword)
    : null;
  const info = (webinar.meetingInfo ?? "").trim();
  // 補充資訊若已經貼了整段邀請（含 ID／密碼），結構欄位那兩行就不再重複列
  const infoDigits = digitsOnly(info);
  const showId =
    !isResource && !!webinar.meetingId && !(digitsOnly(webinar.meetingId) && infoDigits.includes(digitsOnly(webinar.meetingId)));
  const showPwd = !isResource && !!webinar.meetingPassword && !info.includes(webinar.meetingPassword);
  const hasMeetingBox = !!(info || showId || showPwd || joinUrl);

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-gray-200 p-6 sm:p-8">
        {webinar.dmImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={webinar.dmImage}
            alt={`${webinar.title} ${isResource ? "主視覺" : "講座 DM"}`}
            className="mb-5 w-full rounded-xl"
          />
        )}
        <div className="mb-2 text-xs font-medium text-gray-400">活動資訊</div>
        <h1 className="mb-3 text-2xl font-bold">{webinar.title}</h1>
        {webinar.description && (
          <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {webinar.description}
          </p>
        )}

        {hasMeetingBox && (
          <section className="mb-6 rounded-xl bg-gray-50 px-4 py-3">
            <div className="mb-2 text-sm font-bold">{isResource ? "補充說明" : "會議資訊"}</div>
            {joinUrl && (
              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-3 block rounded-lg bg-red-600 px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-red-700"
              >
                🎥 進入會議
              </a>
            )}
            {(showId || showPwd) && (
              <p className="mb-2 text-sm leading-relaxed text-gray-700">
                {showId && <span className="block">會議 ID：{webinar.meetingId}</span>}
                {showPwd && <span className="block">會議密碼：{webinar.meetingPassword}</span>}
              </p>
            )}
            {info && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{linkify(info)}</p>
            )}
          </section>
        )}

        {!isResource && (
          <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
            到報名頁留下 Email，系統會寄一封含會議連結的確認信給你備用（也請檢查垃圾郵件夾）。
          </p>
        )}

        {open ? (
          <Link
            href={`/webinar/${slug}`}
            className="block rounded-lg bg-black px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-gray-800"
          >
            {isResource ? "前往索取頁" : "前往報名頁"}
          </Link>
        ) : (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-gray-500">
            {isResource ? "此活動已結束" : "此講座報名已結束"}
          </p>
        )}
      </div>
    </main>
  );
}
