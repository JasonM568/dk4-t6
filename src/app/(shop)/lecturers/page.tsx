import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "量子講師群 — 希望學院學習平台" };

export default async function LecturersPage() {
  if (!(await isPageEnabled("lecturers"))) notFound();

  return (
    <SitePageShell
      title="量子講師群"
      subtitle="認識希望學院的講師陣容，跟著最懂量子知識的老師一起學習。"
    />
  );
}
