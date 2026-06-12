import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "講座邀約 — 希望學院學習平台" };

export default async function SpeakingPage() {
  if (!(await isPageEnabled("speaking"))) notFound();

  return (
    <SitePageShell
      title="講座邀約"
      subtitle="歡迎企業、學校與社群邀請希望學院講師舉辦講座與工作坊。"
    />
  );
}
