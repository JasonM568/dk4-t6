"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";

export type KnowledgeFormState = { error?: string; success?: string } | null;
const slugRe = /^[a-z0-9-]+$/;

function readForm(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const coverImage = String(formData.get("coverImage") ?? "").trim() || null;
  const images = formData.getAll("images").map(String).filter((url) => /^https?:\/\//.test(url));
  const tags = String(formData.get("tags") ?? "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  const visibility = String(formData.get("visibility") ?? "PUBLIC");
  const status = String(formData.get("status") ?? "DRAFT");
  if (!slugRe.test(slug)) return { error: "網址代稱只能用小寫英數與連字號" as const };
  if (!title || !summary || !content) return { error: "請填寫標題、摘要與內文" as const };
  if (!["PUBLIC", "SUBSCRIBER"].includes(visibility) || !["DRAFT", "PUBLISHED", "UNPUBLISHED"].includes(status)) return { error: "選項內容不正確" as const };
  return { slug, title, summary, content, coverImage, images, tags, visibility, status };
}
function refresh(slug?: string) { revalidatePath("/admin/settings"); revalidatePath("/admin/settings/knowledge"); revalidatePath("/knowledge"); if (slug) revalidatePath(`/knowledge/${slug}`); }

export async function createKnowledgeArticle(_prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  await requireFullAdmin(); const data = readForm(formData); if ("error" in data) return data;
  try { await prisma.knowledgeArticle.create({ data: { ...data, publishedAt: data.status === "PUBLISHED" ? new Date() : null } }); }
  catch { return { error: `網址代稱「${data.slug}」已被使用` }; }
  refresh(data.slug); return { success: "文章已建立" };
}
export async function updateKnowledgeArticle(id: string, _prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  await requireFullAdmin(); const data = readForm(formData); if ("error" in data) return data;
  try { await prisma.knowledgeArticle.update({ where: { id }, data: { ...data, publishedAt: data.status === "PUBLISHED" ? new Date() : null } }); }
  catch { return { error: `網址代稱「${data.slug}」已被使用` }; }
  refresh(data.slug); return { success: "文章已更新" };
}
export async function deleteKnowledgeArticle(id: string, slug: string) { await requireFullAdmin(); await prisma.knowledgeArticle.delete({ where: { id } }); refresh(slug); }
