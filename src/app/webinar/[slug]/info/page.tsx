import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { WEALTH5_CHECK_PATH, WEALTH5_CHECK_SLUG } from "@/lib/wealth5-check";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { publicMeetingNotes } from "@/lib/meeting";

// 活動資訊頁：報名頁（/webinar/[slug]）的姊妹頁，訪客填完表單可點進來，也可直接轉傳。
// 只放 DM、說明、會議補充資訊（時間／注意事項）；**不放**講座連結、會議 ID、密碼——
// 這頁是公開網址，連結只走信件與填完當下的畫面。select 刻意不取那三欄（落地頁欄位最小化）。
export const dynamic = "force-dynamic";

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
  // 會議補充資訊常被貼整段 Zoom 邀請（含網址／ID／密碼）：公開頁只留時間與注意事項那些行
  const notes = publicMeetingNotes(webinar.meetingInfo);
  const open =
    webinar.isActive &&
    !hasEndedInTaipei(webinar.endDate) &&
    (!webinar.unpublishAt || webinar.unpublishAt > new Date());

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

        {notes && (
          <section className="mb-6 rounded-xl bg-gray-50 px-4 py-3">
            <div className="mb-1 text-sm font-bold">{isResource ? "補充說明" : "會議資訊"}</div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{notes}</p>
          </section>
        )}

        {!isResource && (
          <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
            進會議的連結已寄到你登記的信箱（也請檢查垃圾郵件夾）。沒收到或還沒登記？到報名頁填一次，連結會再寄給你。
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
