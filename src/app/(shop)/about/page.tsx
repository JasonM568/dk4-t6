import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";
import { ChancellorIntro } from "@/components/chancellor-intro";
import { ABOUT_FEATURES, ABOUT_INTRO, ABOUT_STATS } from "@/lib/site-content/about";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "關於我們 — 希望學院學習平台" };

// 關於我們：區塊順序照舊官網 academy4hope.com/about（理念＋照片 → 數字 → 特色 → 院長），版型用新平台風格
export default async function AboutPage() {
  if (!(await isPageEnabled("about"))) notFound();

  return (
    <SitePageShell title="關於我們" subtitle={ABOUT_INTRO.heading}>
      <div className="space-y-16">
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div className="space-y-4 leading-relaxed text-gray-700">
            <h2 className="text-2xl font-bold text-gray-900">{ABOUT_INTRO.heading}</h2>
            {ABOUT_INTRO.paragraphs.map((p) => <p key={p}>{p}</p>)}
          </div>
          <div className="grid gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ABOUT_INTRO.photos[0].src} alt={ABOUT_INTRO.photos[0].alt} className="aspect-video w-full rounded-2xl object-cover" />
            <div className="grid grid-cols-2 gap-3">
              {ABOUT_INTRO.photos.slice(1).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.src} src={p.src} alt={p.alt} className="aspect-video w-full rounded-xl object-cover" />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {ABOUT_STATS.map((s) => (
            <div key={s.value} className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white">
              <div className="text-4xl font-bold">
                {s.value}<span className="ml-1 text-lg font-medium">{s.unit}</span>
              </div>
              <p className="mt-2 text-sm text-indigo-100">{s.text}</p>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-8 text-center text-2xl font-bold sm:text-3xl">希望學院特色</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ABOUT_FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-6 text-center transition hover:-translate-y-0.5 hover:shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.icon} alt="" className="mx-auto h-16 w-16" />
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-8 text-center text-2xl font-bold sm:text-3xl">院長介紹</h2>
          <ChancellorIntro />
        </section>
      </div>
    </SitePageShell>
  );
}
