"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";

// 自訂分頁 CRUD（分頁管理僅管理員，與 togglePageAction 同級守門）

export type CustomPageFormState = { error?: string; success?: string } | null;

const SLUG_RE = /^[a-z0-9-]+$/;

function parsePageForm(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const images = formData.getAll("images").map(String).filter(Boolean);
  const isPublished = formData.get("isPublished") === "on";
  const showInNav = formData.get("showInNav") === "on";

  if (!SLUG_RE.test(slug))
    return { error: "網址代稱只能用小寫英數與連字號（例：about-us）" as const };
  if (!title) return { error: "請填寫頁面標題" as const };
  if (!content && images.length === 0)
    return { error: "內文與圖片至少要有一項" as const };
  if (images.some((u) => !/^https?:\/\//.test(u)))
    return { error: "圖片網址格式錯誤" as const };
  return { slug, title, content, images, isPublished, showInNav };
}

export async function createCustomPageAction(
  _prev: CustomPageFormState,
  formData: FormData,
): Promise<CustomPageFormState> {
  await requireFullAdmin();
  const parsed = parsePageForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  try {
    await prisma.customPage.create({ data: parsed });
  } catch {
    return { error: `網址代稱「${parsed.slug}」已被使用` };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout"); // navbar 全站
  return { success: `已建立頁面：/p/${parsed.slug}` };
}

export async function updateCustomPageAction(
  id: string,
  _prev: CustomPageFormState,
  formData: FormData,
): Promise<CustomPageFormState> {
  await requireFullAdmin();
  const parsed = parsePageForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  try {
    await prisma.customPage.update({ where: { id }, data: parsed });
  } catch {
    return { error: `網址代稱「${parsed.slug}」已被使用` };
  }
  revalidatePath("/admin/settings");
  revalidatePath(`/p/${parsed.slug}`);
  revalidatePath("/", "layout");
  return { success: "已更新" };
}

/** 刪除自訂頁（客戶端先 confirm） */
export async function deleteCustomPageAction(id: string) {
  await requireFullAdmin();
  await prisma.customPage.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
}
