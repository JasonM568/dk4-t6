import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";
import { LECTURER_CARDS, LECTURERS_GROUP_IMAGE } from "@/lib/site-content/lecturers";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "量子講師群 — 希望學院學習平台" };

// 照舊官網 academy4hope.com/lecturer-group：一張合照＋六張講師卡，不加文字（Jason 2026-10-28 決定）
export default async function LecturersPage() {
  if (!(await isPageEnabled("lecturers"))) notFound();

  return (
    <SitePageShell
      title="量子講師群"
      subtitle="認識希望學院的講師陣容，跟著最懂量子知識的老師一起學習。"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LECTURERS_GROUP_IMAGE.src} alt={LECTURERS_GROUP_IMAGE.alt} className="w-full rounded-2xl" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {LECTURER_CARDS.map((c) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={c.src} src={c.src} alt={c.alt} loading="lazy" className="w-full rounded-2xl border border-gray-100 shadow-sm" />
        ))}
      </div>
    </SitePageShell>
  );
}
