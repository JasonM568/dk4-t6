import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { RichText } from "@/components/rich-text";

export const dynamic = "force-dynamic";
export default async function KnowledgeArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await prisma.knowledgeArticle.findUnique({ where: { slug } });
  if (!article || article.status !== "PUBLISHED" || (article.unpublishAt && article.unpublishAt <= new Date())) notFound();
  if (article.visibility === "SUBSCRIBER") { const user = await getAuthUser(); const access = user && await prisma.courseGroupMember.findFirst({ where: { email: user.email?.trim().toLowerCase(), group: { kind: "SUBSCRIPTION", isActive: true } }, select: { id: true } }); if (!access) return <main className="mx-auto max-w-xl flex-1 px-4 py-20 text-center"><div className="rounded-2xl border p-8"><div className="text-3xl">🔒</div><h1 className="mt-3 text-2xl font-bold">訂閱會員限定文章</h1><p className="mt-2 text-sm text-gray-500">此篇內容開放給訂閱會員閱讀。</p><Link href="/knowledge" className="mt-5 inline-block text-sm text-indigo-600 underline">回到知識專區</Link></div></main>; }
  return <main className="mx-auto max-w-3xl flex-1 px-4 py-10"><Link href="/knowledge" className="text-sm text-indigo-600 hover:underline">← 知識專區</Link>{article.coverImage&&<img src={article.coverImage} alt="" className="mt-5 max-h-96 w-full rounded-xl object-cover"/>}<div className="mt-6 text-sm text-indigo-600">{article.tags.map(tag=><span key={tag} className="mr-2">#{tag}</span>)}</div><h1 className="mt-2 text-3xl font-bold">{article.title}</h1><p className="mt-3 text-lg leading-relaxed text-gray-500">{article.summary}</p><article className="mt-8"><RichText text={article.content}/>{article.images.map((image,index)=><img key={image} src={image} alt={`${article.title} 圖片 ${index+1}`} className="my-5 rounded-xl"/>)}</article></main>;
}
