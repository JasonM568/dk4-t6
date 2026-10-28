import Link from "next/link";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { KnowledgeManager } from "./knowledge-manager";

export const metadata = { title: "知識專欄 — 管理後台" };
export const dynamic = "force-dynamic";
export default async function KnowledgeSettingsPage() {
  await pageGuardFullAdmin();
  // 舊站匯入後有 2,000+ 篇、每篇帶幾十 KB 的 HTML：不能整表丟給 client component。
  // 列表只取最近 100 篇、不取 contentHtml；匯入文章在卡片上標示，內文在這裡不可編輯。
  const [articles, total] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, slug: true, title: true, summary: true, content: true, coverImage: true, images: true, tags: true, visibility: true, status: true, publishedAt: true, unpublishAt: true, createdAt: true, updatedAt: true, wpId: true, sourceUrl: true },
    }),
    prisma.knowledgeArticle.count(),
  ]);
  return <div className="max-w-3xl"><Link href="/admin/settings" className="text-sm text-indigo-600 hover:underline">← 分頁管理</Link><h1 className="mt-3 text-2xl font-bold">院長乾貨區</h1><p className="mb-6 mt-1 text-sm text-gray-500">文章會出現在前台「院長乾貨區」；設定為訂閱限定時，只有具任一訂閱專區會籍的會員可以閱讀。標籤填分類名稱（財經快報／全球財經／顧名思易／晨間小語／搶先試看）前台才會歸到對應頁籤。共 {total} 篇，這裡列最近更新的 {articles.length} 篇。</p><KnowledgeManager articles={articles.map(({ wpId, sourceUrl, ...article }) => ({ ...article, imported: wpId !== null, sourceUrl, publishedAt: article.publishedAt?.toISOString() ?? null, unpublishAt: article.unpublishAt?.toISOString() ?? null }))} /></div>;
}
