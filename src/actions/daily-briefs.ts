"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";

export type DailyBriefFormState = { error?: string; success?: string } | null;

function taipeiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function titleForDate(dateKey: string) {
  return `每日財經剪報｜${dateKey.replaceAll("-", ".")}`;
}

function imagesFrom(formData: FormData) {
  return formData.getAll("images").map(String).filter((url) => /^https?:\/\//.test(url));
}

function revalidate(groupSlug: string) {
  revalidatePath("/admin/subscription");
  revalidatePath(`/admin/subscription/${groupSlug}/briefs`);
  revalidatePath(`/zone/${groupSlug}`);
  revalidatePath(`/zone/${groupSlug}/briefs`);
}

/** 建立今日剪報：日期、標題與三款封面由系統決定，圖片依上傳順序寫入。 */
export async function createTodayDailyBrief(
  groupId: string,
  groupSlug: string,
  _prev: DailyBriefFormState,
  formData: FormData,
): Promise<DailyBriefFormState> {
  await requireEditor();
  const images = imagesFrom(formData);
  if (!images.length) return { error: "請至少上傳一張新聞截圖" };
  const dateKey = taipeiDateKey();
  const prior = await prisma.dailyBrief.count({ where: { groupId } });
  try {
    await prisma.dailyBrief.create({
      data: {
        groupId,
        dateKey,
        title: titleForDate(dateKey),
        coverVariant: prior % 3,
        status: "PUBLISHED",
        publishedAt: new Date(),
        images: { create: images.map((imageUrl, sortOrder) => ({ imageUrl, sortOrder })) },
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint"))
      return { error: "今日剪報已建立，請在下方列表補充或調整圖片" };
    throw error;
  }
  revalidate(groupSlug);
  return { success: `已發布 ${titleForDate(dateKey)}` };
}

export async function updateDailyBrief(
  id: string,
  groupSlug: string,
  _prev: DailyBriefFormState,
  formData: FormData,
): Promise<DailyBriefFormState> {
  await requireEditor();
  const title = String(formData.get("title") ?? "").trim();
  const status = String(formData.get("status") ?? "DRAFT");
  const images = imagesFrom(formData);
  if (!title) return { error: "請填寫標題" };
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(status)) return { error: "發布狀態不正確" };
  if (!images.length) return { error: "至少保留一張新聞截圖" };
  await prisma.dailyBrief.update({
    where: { id },
    data: {
      title,
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      images: { deleteMany: {}, create: images.map((imageUrl, sortOrder) => ({ imageUrl, sortOrder })) },
    },
  });
  revalidate(groupSlug);
  return { success: "剪報已更新" };
}

export async function deleteDailyBrief(id: string, groupSlug: string) {
  await requireEditor();
  await prisma.dailyBrief.delete({ where: { id } });
  revalidate(groupSlug);
}
