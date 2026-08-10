import { notFound } from "next/navigation";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "知識專區 — 希望學院學習平台" };

export default async function KnowledgePage() {
  if (!(await isPageEnabled("knowledge"))) notFound();
  const user = await getAuthUser();
  const member = user ? await prisma.courseGroupMember.findFirst({ where: { email: user.email?.trim().toLowerCase(), group: { kind: "SUBSCRIPTION", isActive: true } }, select: { id: true } }) : null;
  const articles = await prisma.knowledgeArticle.findMany({
    where: {
      status: "PUBLISHED",
      OR: [{ unpublishAt: null }, { unpublishAt: { gt: new Date() } }],
      ...(member ? {} : { visibility: "PUBLIC" }),
    },
    orderBy: { publishedAt: "desc" },
  });

  return (
    <SitePageShell
      title="知識專區"
      subtitle="精選文章與學習資源，課堂之外持續累積你的知識存摺。"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{articles.map(article => <Link key={article.id} href={`/knowledge/${article.slug}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md">{article.coverImage ? <img src={article.coverImage} alt="" className="h-36 w-full object-cover"/> : <div className="h-36 bg-gradient-to-br from-indigo-900 to-slate-700"/>}<div className="p-4"><div className="text-xs text-indigo-600">{article.visibility === "SUBSCRIBER" ? "🔒 訂閱會員限定" : "顧院長知識專欄"}</div><h2 className="mt-1 font-bold">{article.title}</h2><p className="mt-2 line-clamp-3 text-sm text-gray-500">{article.summary}</p></div></Link>)}{!articles.length&&<p className="text-sm text-gray-400">文章籌備中，敬請期待。</p>}</div>
    </SitePageShell>
  );
}
