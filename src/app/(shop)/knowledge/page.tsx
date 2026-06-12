import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "知識專區 — 希望學院學習平台" };

export default async function KnowledgePage() {
  if (!(await isPageEnabled("knowledge"))) notFound();

  return (
    <SitePageShell
      title="知識專區"
      subtitle="精選文章與學習資源，課堂之外持續累積你的知識存摺。"
    />
  );
}
