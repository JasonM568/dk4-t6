import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  signupState,
  CLOSED_MESSAGE,
  remainingSeats,
  mapUrl,
  SIGNUP_REQUEST_STATUS,
} from "@/lib/session-signup-page";
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
    where: { signupSlug: slug },
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
  const { slug } = await params;
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

      {session.dmImages.length > 0 && (
        <div className="mb-8 space-y-5">
          {session.dmImages.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={session.title} className="w-full rounded-2xl" />
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-800">{children}</dd>
    </div>
  );
}
