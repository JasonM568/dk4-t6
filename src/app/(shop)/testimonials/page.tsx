import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";
import { TESTIMONIAL_IG_PROFILE, TESTIMONIAL_REELS, reelEmbedUrl } from "@/lib/site-content/testimonials";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "學員見證 — 希望學院學習平台" };

// 照舊官網 academy4hope.com/student：22 支 Instagram Reel。用 iframe 版嵌入，不載 instagram 的 embed.js
// （script-src 白名單不用開，CSP 只加 frame-src www.instagram.com）；lazy 讓 22 個 iframe 不要一次全載。
export default async function TestimonialsPage() {
  if (!(await isPageEnabled("testimonials"))) notFound();

  return (
    <SitePageShell title="學員見證" subtitle="量子思維課程學員的真實分享，來自希望學院 Instagram。">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {TESTIMONIAL_REELS.map((code) => (
          <div key={code} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <iframe
              src={reelEmbedUrl(code)}
              title={`學員見證 ${code}`}
              loading="lazy"
              allow="encrypted-media"
              className="aspect-[9/16] w-full"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-gray-500">
        更多學員分享請追蹤{" "}
        <a href={TESTIMONIAL_IG_PROFILE} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">
          @ceohope_tw
        </a>
      </p>
    </SitePageShell>
  );
}
