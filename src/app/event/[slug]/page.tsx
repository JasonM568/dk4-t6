import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  signupState,
  CLOSED_MESSAGE,
  remainingSeats,
  mapUrl,
  SIGNUP_REQUEST_STATUS,
  parseDmBlocks,
  type DmBlock,
} from "@/lib/session-signup-page";
import { youTubeEmbedUrl } from "@/lib/video-embed";
import { SessionSignupForm } from "./signup-form";
import { ExternalSignupCta } from "./external-signup-cta";

// 報名開放與否是時間觸發的（開始／截止／開課日），沒有 admin 動作可 revalidate；
// 名額也要即時。報名頁流量低，一律動態渲染（同 /webinar/[slug] 的取捨）。
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await prisma.courseSession.findUnique({
    where: { signupSlug: slug.toLowerCase() }, // 同下方：代稱一律以小寫比對
    select: { title: true, dmImage: true },
  });
  if (!session) return { title: "課程報名" };
  return {
    title: `${session.title} — 課程報名`,
    openGraph: {
      title: session.title,
      ...(session.dmImage ? { images: [session.dmImage] } : {}),
    },
  };
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
};

export default async function EventSignupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  // 代稱存檔時一律小寫，但人手打／複製的網址常帶大寫（Q2-taipei-0919）。
  // 查詢前正規化，大小寫不同的網址都開得起來，不會讓人看到 404 以為頁面沒建。
  const slug = rawSlug.toLowerCase();
  const session = await prisma.courseSession.findUnique({ where: { signupSlug: slug } });
  if (!session) notFound();

  // 導去 1shop 的模式：席次由對方控管，這一頁不算名額也不查待確認名單
  const external = session.signupUrl;

  const [confirmed, pending] = external
    ? [0, 0]
    : await Promise.all([
        prisma.sessionSignup.count({
          where: { sessionId: session.id, deferredToSessionId: null },
        }),
        prisma.sessionSignupRequest.count({
          where: { sessionId: session.id, status: SIGNUP_REQUEST_STATUS.PENDING },
        }),
      ]);
  const taken = confirmed + pending;
  const state = signupState({
    session: external ? { ...session, signupQuota: null } : session,
    taken,
    now: new Date(),
  });
  const remaining = external ? null : remainingSeats(session.signupQuota, taken);

  const blocks = parseDmBlocks(session.dmBlocks);

  const dateText = session.eventDate
    ? session.eventDate.toLocaleDateString("zh-TW", DATE_FMT)
    : null;
  const endText =
    session.endDate && session.endDate.getTime() !== session.eventDate?.getTime()
      ? session.endDate.toLocaleDateString("zh-TW", DATE_FMT)
      : null;

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-14">
      {session.dmImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.dmImage}
          alt={`${session.title} 課程 DM`}
          className="mb-7 w-full rounded-2xl"
        />
      )}

      <h1 className="mb-5 text-2xl font-bold leading-snug sm:text-3xl">{session.title}</h1>

      <dl className="mb-7 space-y-2.5 rounded-2xl border border-gray-200 bg-gray-50/60 px-5 py-4 text-sm">
        {dateText && (
          <Row label="上課日期">
            {dateText}
            {endText && ` ～ ${endText}`}
          </Row>
        )}
        {session.venue && <Row label="上課地點">{session.venue}</Row>}
        {session.address && (
          <Row label="地址">
            <a
              href={mapUrl(session.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-800 underline underline-offset-2"
            >
              {session.address}
            </a>
          </Row>
        )}
        {session.signupPriceNote && <Row label="費用">{session.signupPriceNote}</Row>}
        {remaining !== null && state.open && (
          <Row label="名額">
            {remaining > 0 ? (
              <span className={remaining <= 5 ? "font-medium text-red-700" : ""}>
                尚餘 {remaining} 位
              </span>
            ) : (
              "已額滿"
            )}
          </Row>
        )}
      </dl>

      {session.signupIntro && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">課程介紹</h2>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-700">
            {session.signupIntro}
          </p>
        </section>
      )}

      {/* 課程詳情：圖片與影片依後台排好的順序混排。
          排版比照 1shop（.customize > .img img { display:block; width:100% }）——
          長 DM 是切成多張圖上傳的，區塊間零間距、圖片零圓角才拼得回一張無縫長圖；
          手機負 margin 突破容器 padding 滿版貼邊（1shop 的 mobile-padding-0），
          桌機整包一個圓角框。 */}
      {blocks.length > 0 && (
        <div className="-mx-5 mb-8 sm:mx-0 sm:overflow-hidden sm:rounded-2xl">
          {blocks.map((b, i) => (
            <DmBlockView key={`${b.type}-${b.url}-${i}`} block={b} title={session.title} />
          ))}
        </div>
      )}

      <section className="mb-8 scroll-mt-6" id="signup">
        <h2 className="mb-3 text-lg font-bold">立即報名</h2>
        {state.open && external ? (
          <ExternalSignupCta
            slug={slug}
            title={session.title}
            url={external}
          />
        ) : state.open ? (
          <SessionSignupForm
            slug={slug}
            maxSeats={remaining === null ? undefined : remaining}
          />
        ) : (
          <p className="rounded-2xl bg-gray-100 px-5 py-8 text-center text-gray-600">
            {CLOSED_MESSAGE[state.reason]}
          </p>
        )}
      </section>

      {/* 導去 1shop 時款項由對方收，這裡不談繳費方式，免得兩邊說法打架 */}
      {!external && session.signupPayNote && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">繳費方式</h2>
          <p className="whitespace-pre-line rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-[15px] leading-relaxed text-gray-700">
            {session.signupPayNote}
          </p>
        </section>
      )}

      {session.signupNotice && (
        <section>
          <h2 className="mb-3 text-lg font-bold">注意事項</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {session.signupNotice}
          </p>
        </section>
      )}
    </main>
  );
}

/** 詳情區塊：YouTube 走 nocookie iframe（CSP frame-src 已放行）；
 *  影片檔直連走 <video>（media-src 只放行 Supabase）；其餘當圖片。
 *  單一區塊不帶圓角與間距——無縫拼接由外層容器統一管（見上方註解）。 */
function DmBlockView({ block, title }: { block: DmBlock; title: string }) {
  if (block.type === "video") {
    const embed = youTubeEmbedUrl(block.url);
    return embed ? (
      <div className="aspect-video bg-black">
        <iframe
          src={embed}
          title={title}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    ) : (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={block.url} controls playsInline className="block w-full bg-black" />
    );
  }
  return (
    // display:block 是關鍵——行內圖片的 baseline 對齊會在每張圖底下留 3~4px 縫，
    // 這正是 Jason 回報「圖片之間有空白間隙」的元凶（1shop 同樣用 display:block 解）
    // eslint-disable-next-line @next/next/no-img-element
    <img src={block.url} alt={title} className="block w-full" />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-800">{children}</dd>
    </div>
  );
}
