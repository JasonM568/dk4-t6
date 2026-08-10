import Link from "next/link";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { KnowledgeManager } from "./knowledge-manager";

export const metadata = { title: "知識專欄 — 管理後台" };
export const dynamic = "force-dynamic";
export default async function KnowledgeSettingsPage() {
  await pageGuardFullAdmin();
  const articles = await prisma.knowledgeArticle.findMany({ orderBy: { updatedAt: "desc" } });
  return <div className="max-w-3xl"><Link href="/admin/settings" className="text-sm text-indigo-600 hover:underline">← 分頁管理</Link><h1 className="mt-3 text-2xl font-bold">知識專欄</h1><p className="mb-6 mt-1 text-sm text-gray-500">文章會出現在前台「知識專區」；設定為訂閱限定時，只有具任一訂閱專區會籍的會員可以閱讀。</p><KnowledgeManager articles={articles.map((article) => ({ ...article, publishedAt: article.publishedAt?.toISOString() ?? null, unpublishAt: article.unpublishAt?.toISOString() ?? null }))} /></div>;
}
