import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { isPageEnabled } from "@/lib/site-pages";
import { SitePageShell } from "@/components/site-page-shell";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { KNOWLEDGE_CATEGORIES, knowledgeCategoryBySlug } from "@/lib/knowledge-categories";

// 開關存 DB，不能讓 build 時把結果凍結成靜態頁
export const dynamic = "force-dynamic";

export const metadata = { title: "院長乾貨區 — 希望學院學習平台" };

const PAGE_SIZE = 24;

function formatDate(d: Date | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// 院長乾貨區（舊官網 academy4hope.com/category/knowledge 複刻）：分類頁籤＋分頁。
// 訂閱限定文章對非會員也列出（鎖頭標示），點進去才擋——讓人看得到有什麼才會想訂閱。
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ cat?: string; page?: string }> }) {
  if (!(await isPageEnabled("knowledge"))) notFound();
  const { cat, page: pageParam } = await searchParams;
  const category = knowledgeCategoryBySlug(cat);
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const user = await getAuthUser();
  const member = user ? await prisma.courseGroupMember.findFirst({ where: { email: user.email?.trim().toLowerCase(), group: { kind: "SUBSCRIPTION", isActive: true } }, select: { id: true } }) : null;

  const where: Prisma.KnowledgeArticleWhereInput = {
    status: "PUBLISHED",
    OR: [{ unpublishAt: null }, { unpublishAt: { gt: new Date() } }],
    ...(category ? { tags: { has: category.name } } : {}),
  };
  const [total, articles] = await Promise.all([
    prisma.knowledgeArticle.count({ where }),
    prisma.knowledgeArticle.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, slug: true, title: true, summary: true, coverImage: true, tags: true, visibility: true, publishedAt: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/knowledge?${new URLSearchParams({ ...(category ? { cat: category.slug } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`.replace(/\?$/, "");

  return (
    <SitePageShell
      title="院長乾貨區"
      subtitle="顧院長每日整理的新聞速報、財經快報、全球財經與晨間小語，課堂之外持續累積你的知識存摺。"
    >
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="分類">
        <Link href="/knowledge" className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${!category ? "bg-black text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>全部</Link>
        {KNOWLEDGE_CATEGORIES.map((c) => (
          <Link key={c.slug} href={`/knowledge?cat=${c.slug}`} className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${category?.slug === c.slug ? "bg-black text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}>{c.name}</Link>
        ))}
      </nav>
      {category && <p className="mb-6 text-sm text-gray-500">{category.blurb}</p>}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => {
          const locked = article.visibility === "SUBSCRIBER" && !member;
          const tag = article.tags.find((t) => KNOWLEDGE_CATEGORIES.some((c) => c.name === t)) ?? article.tags[0];
          return (
            <Link key={article.id} href={`/knowledge/${article.slug}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md">
              {article.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={article.coverImage} alt="" loading="lazy" className="h-40 w-full object-cover" />
              ) : (
                <div className="h-40 bg-gradient-to-br from-indigo-900 to-slate-700" />
              )}
              <div className="p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-indigo-600">{tag ?? "院長乾貨區"}</span>
                  <span className="text-gray-400">{formatDate(article.publishedAt)}</span>
                </div>
                <h2 className="mt-1 font-bold">{locked && <span className="mr-1" title="訂閱會員限定">🔒</span>}{article.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm text-gray-500">{article.summary}</p>
              </div>
            </Link>
          );
        })}
        {!articles.length && <p className="text-sm text-gray-400">這個分類還沒有文章。</p>}
      </div>

      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="分頁">
          {page > 1 ? <Link href={href(page - 1)} className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50">← 上一頁</Link> : <span className="rounded-lg border border-gray-200 px-4 py-2 text-gray-300">← 上一頁</span>}
          <span className="text-gray-500">第 {page} / {totalPages} 頁（共 {total} 篇）</span>
          {page < totalPages ? <Link href={href(page + 1)} className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50">下一頁 →</Link> : <span className="rounded-lg border border-gray-200 px-4 py-2 text-gray-300">下一頁 →</span>}
        </nav>
      )}
    </SitePageShell>
  );
}
