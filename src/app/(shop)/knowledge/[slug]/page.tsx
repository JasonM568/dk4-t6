import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { RichText } from "@/components/rich-text";
import { ArticleHtml } from "@/components/article-html";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge-categories";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await prisma.knowledgeArticle.findUnique({ where: { slug }, select: { title: true, status: true } });
  return { title: article?.status === "PUBLISHED" ? `${article.title} — 院長乾貨區` : "院長乾貨區" };
}

function formatDate(d: Date | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric" }).format(d);
}

export default async function KnowledgeArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await prisma.knowledgeArticle.findUnique({ where: { slug } });
  if (!article || article.status !== "PUBLISHED" || (article.unpublishAt && article.unpublishAt <= new Date())) notFound();
  const category = article.tags.find((t) => KNOWLEDGE_CATEGORIES.some((c) => c.name === t));
  const categorySlug = KNOWLEDGE_CATEGORIES.find((c) => c.name === category)?.slug;
  const backHref = categorySlug ? `/knowledge?cat=${categorySlug}` : "/knowledge";

  if (article.visibility === "SUBSCRIBER") {
    const user = await getAuthUser();
    const access = user && await prisma.courseGroupMember.findFirst({ where: { email: user.email?.trim().toLowerCase(), group: { kind: "SUBSCRIPTION", isActive: true } }, select: { id: true } });
    if (!access) {
      return (
        <main className="mx-auto max-w-xl flex-1 px-4 py-20 text-center">
          <div className="rounded-2xl border p-8">
            <div className="text-3xl">🔒</div>
            <h1 className="mt-3 text-2xl font-bold">訂閱會員限定文章</h1>
            <p className="mt-2 text-lg font-medium text-gray-800">{article.title}</p>
            <p className="mt-2 text-sm text-gray-500">此篇內容開放給知識訂閱會員閱讀{user ? "，你目前的帳號沒有有效的訂閱會籍。" : "，請先登入訂閱會員帳號。"}</p>
            <div className="mt-6 flex justify-center gap-3">
              {!user && <Link href={`/login?next=/knowledge/${slug}`} className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800">登入</Link>}
              <Link href={backHref} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium hover:bg-gray-50">回到院長乾貨區</Link>
            </div>
          </div>
        </main>
      );
    }
  }

  return (
    <main className="mx-auto max-w-3xl flex-1 px-4 py-10">
      <Link href={backHref} className="text-sm text-indigo-600 hover:underline">← 院長乾貨區{category ? `／${category}` : ""}</Link>
      {article.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={article.coverImage} alt="" className="mt-5 max-h-96 w-full rounded-xl object-cover" />
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-indigo-600">
        {article.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        {article.publishedAt && <span className="text-gray-400">{formatDate(article.publishedAt)}</span>}
      </div>
      <h1 className="mt-2 text-3xl font-bold">{article.title}</h1>
      {!article.contentHtml && <p className="mt-3 text-lg leading-relaxed text-gray-500">{article.summary}</p>}
      <article className="mt-8">
        {article.contentHtml ? <ArticleHtml html={article.contentHtml} /> : <RichText text={article.content} />}
        {article.images.map((image, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={image} src={image} alt={`${article.title} 圖片 ${index + 1}`} className="my-5 rounded-xl" />
        ))}
      </article>
    </main>
  );
}
