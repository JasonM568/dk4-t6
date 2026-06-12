"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import {
  getProfileRole,
  getProfilesByEmails,
  createMember,
  uploadCourseImage,
} from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/auth/role";
import { prisma } from "@/lib/db";

// 後台 action 守門：先驗登入，再查 profiles.role 確認 admin
async function requireAdmin() {
  const user = await getAuthUser();
  if (!user) {
    throw new Error("需要管理員權限");
  }
  const role = await getProfileRole(user.id);
  if (!isAdminRole(role)) {
    throw new Error("需要管理員權限");
  }
}

const courseSchema = z.object({
  slug: z
    .string()
    .min(1, "請填寫 slug（網址代稱）")
    .regex(
      /^[a-z0-9-]+$/,
      "slug 只能用小寫英文、數字與連字號（-），不能有中文、空格或大寫",
    ),
  title: z.string().min(1, "請填寫課程標題"),
  description: z.string().min(1, "請填寫課程描述"),
  coverImage: z
    .string()
    .url("封面圖片要填完整網址（https:// 開頭），沒有圖片請留空")
    .or(z.literal("")),
  price: z.coerce.number({ message: "售價要填數字" }).int("售價要填整數").min(0, "售價不能是負數"),
  isPublished: z.coerce.boolean(),
});

export type CourseFormState = { error?: string } | null;

// 把表單內容轉成 schema 輸入（trim + slug 自動轉小寫，減少驗證失敗）
function courseInput(formData: FormData) {
  return {
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    coverImage: String(formData.get("coverImage") ?? "").trim(),
    price: formData.get("price"),
    isPublished: formData.get("isPublished") === "on",
  };
}

function firstZodError(parsed: { error: z.ZodError }): string {
  return parsed.error.issues[0]?.message ?? "輸入內容有誤，請檢查後再試";
}

// 處理表單裡的圖片：上傳封面與介紹圖，回傳要存進 DB 的網址。
// - 封面：有選新檔案就上傳並取代；否則沿用網址欄位的值
// - 介紹圖：保留的既有圖（keepIntroImages）+ 新上傳的檔案，依序合併
async function resolveCourseImages(
  formData: FormData,
  coverUrlFromText: string,
): Promise<
  { ok: true; coverImage: string; introImages: string[] } | { ok: false; error: string }
> {
  let coverImage = coverUrlFromText;

  const coverFile = formData.get("coverImageFile");
  if (coverFile instanceof File && coverFile.size > 0) {
    const up = await uploadCourseImage(coverFile, "cover");
    if (!up.ok) return { ok: false, error: up.error };
    coverImage = up.url;
  }

  const introImages = formData
    .getAll("keepIntroImages")
    .map(String)
    .filter(Boolean);

  for (const f of formData.getAll("introImageFiles")) {
    if (f instanceof File && f.size > 0) {
      const up = await uploadCourseImage(f, "intro");
      if (!up.ok) return { ok: false, error: up.error };
      introImages.push(up.url);
    }
  }

  return { ok: true, coverImage, introImages };
}

export async function createCourse(
  _prev: CourseFormState,
  formData: FormData,
): Promise<CourseFormState> {
  await requireAdmin();
  const parsed = courseSchema.safeParse(courseInput(formData));
  if (!parsed.success) return { error: firstZodError(parsed) };

  const images = await resolveCourseImages(formData, parsed.data.coverImage);
  if (!images.ok) return { error: images.error };

  try {
    await prisma.course.create({
      data: {
        ...parsed.data,
        coverImage: images.coverImage,
        introImages: images.introImages,
      },
    });
  } catch (e) {
    // slug 是 @unique，撞名給友善訊息
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { error: `slug「${parsed.data.slug}」已被其他課程使用，請換一個` };
    }
    throw e;
  }
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function updateCourse(
  id: string,
  _prev: CourseFormState,
  formData: FormData,
): Promise<CourseFormState> {
  await requireAdmin();
  const parsed = courseSchema.safeParse(courseInput(formData));
  if (!parsed.success) return { error: firstZodError(parsed) };

  const images = await resolveCourseImages(formData, parsed.data.coverImage);
  if (!images.ok) return { error: images.error };

  try {
    await prisma.course.update({
      where: { id },
      data: {
        ...parsed.data,
        coverImage: images.coverImage,
        introImages: images.introImages,
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { error: `slug「${parsed.data.slug}」已被其他課程使用，請換一個` };
    }
    throw e;
  }
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
  redirect("/admin/courses");
}

export async function deleteCourse(id: string) {
  await requireAdmin();
  await prisma.course.delete({ where: { id } });
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function addLesson(courseId: string, formData: FormData) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "");
  const youtubeId = String(formData.get("youtubeId") ?? "");
  const order = Number(formData.get("order") ?? 0);
  const durationSec = formData.get("durationSec")
    ? Number(formData.get("durationSec"))
    : null;
  if (!title || !youtubeId) return;
  await prisma.lesson.create({
    data: { courseId, title, youtubeId, order, durationSec },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function deleteLesson(lessonId: string, courseId: string) {
  await requireAdmin();
  await prisma.lesson.delete({ where: { id: lessonId } });
  revalidatePath(`/admin/courses/${courseId}`);
}

const tierSchema = z.object({
  minTotalSpent: z.coerce.number().int().min(0),
  discountPercent: z.coerce.number().int().min(0).max(100),
});

export async function updateTier(id: string, formData: FormData) {
  await requireAdmin();
  const data = tierSchema.parse({
    minTotalSpent: formData.get("minTotalSpent"),
    discountPercent: formData.get("discountPercent"),
  });
  await prisma.membershipTier.update({ where: { id }, data });
  revalidatePath("/admin/members");
}

// ───────────────────────── 批次功能 ─────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH_ROWS = 500;

export type BatchRowResult = {
  email: string;
  status:
    | "created" // 匯入成功
    | "exists" // 會員已存在
    | "enrolled" // 開通成功
    | "already" // 本來就有權限
    | "notfound" // 查無會員
    | "invalid" // 格式錯誤
    | "error"; // 其他錯誤
  detail?: string;
};

export type BatchState = {
  done: boolean;
  summary?: string;
  results?: BatchRowResult[];
  error?: string;
} | null;

// 把貼上的名單拆成列：支援「email,姓名,密碼」（逗號/全形逗號/Tab 分隔），
// 姓名與密碼可省略；空行與 # 開頭的註解行略過
function parseRows(raw: string): { email: string; name: string; password: string }[] {
  return raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [email = "", name = "", password = ""] = line
        .split(/[,\t，]/)
        .map((s) => s.trim());
      return { email: email.toLowerCase(), name, password };
    });
}

/** 會員批次匯入：建立 Supabase Auth 帳號（profiles 由 QBC trigger 自動建立） */
export async function importMembersAction(
  _prev: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await requireAdmin();

  const raw = String(formData.get("list") ?? "");
  const defaultPassword = String(formData.get("defaultPassword") ?? "").trim();
  const rows = parseRows(raw);

  if (rows.length === 0) return { done: true, error: "名單是空的，請先貼上資料" };
  if (rows.length > MAX_BATCH_ROWS)
    return { done: true, error: `一次最多 ${MAX_BATCH_ROWS} 筆（目前 ${rows.length} 筆），請分批匯入` };

  const results: BatchRowResult[] = [];
  const seen = new Set<string>();

  // 先一次查出已存在的會員，避免逐筆打 API
  const validEmails = rows.map((r) => r.email).filter((e) => EMAIL_RE.test(e));
  const existing = await getProfilesByEmails(validEmails);

  for (const row of rows) {
    if (!EMAIL_RE.test(row.email)) {
      results.push({ email: row.email || "(空白)", status: "invalid", detail: "email 格式錯誤" });
      continue;
    }
    if (seen.has(row.email)) {
      results.push({ email: row.email, status: "invalid", detail: "名單內重複，已略過" });
      continue;
    }
    seen.add(row.email);

    if (existing.has(row.email)) {
      results.push({ email: row.email, status: "exists", detail: "可直接批次開通權限" });
      continue;
    }

    const password = row.password || defaultPassword;
    if (password.length < 6) {
      results.push({
        email: row.email,
        status: "invalid",
        detail: password ? "密碼至少 6 字元" : "未提供密碼，且預設密碼空白",
      });
      continue;
    }

    const created = await createMember({
      email: row.email,
      password,
      displayName: row.name || row.email.split("@")[0],
    });

    if (created.ok) {
      results.push({ email: row.email, status: "created" });
    } else if (created.reason === "exists") {
      results.push({ email: row.email, status: "exists", detail: "可直接批次開通權限" });
    } else {
      results.push({ email: row.email, status: "error", detail: created.message });
    }
  }

  const c = (s: BatchRowResult["status"]) => results.filter((r) => r.status === s).length;
  revalidatePath("/admin/members");
  return {
    done: true,
    summary: `匯入完成：成功 ${c("created")}、已存在 ${c("exists")}、格式錯誤 ${c("invalid")}、失敗 ${c("error")}`,
    results,
  };
}

/** 批次開通課程觀看權限：為名單上的會員建立 Enrollment（冪等） */
export async function batchEnrollAction(
  _prev: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await requireAdmin();

  const courseId = String(formData.get("courseId") ?? "");
  const raw = String(formData.get("list") ?? "");
  const rows = parseRows(raw);

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { done: true, error: "請選擇課程" };
  if (rows.length === 0) return { done: true, error: "名單是空的，請先貼上資料" };
  if (rows.length > MAX_BATCH_ROWS)
    return { done: true, error: `一次最多 ${MAX_BATCH_ROWS} 筆（目前 ${rows.length} 筆），請分批開通` };

  const results: BatchRowResult[] = [];
  const seen = new Set<string>();

  const validEmails = [...new Set(rows.map((r) => r.email).filter((e) => EMAIL_RE.test(e)))];
  const profileMap = await getProfilesByEmails(validEmails);

  // 一次查出已有權限的會員，區分「開通成功」與「本來就有」
  const userIds = [...profileMap.values()].map((p) => p.id);
  const enrolled = new Set(
    (
      await prisma.enrollment.findMany({
        where: { courseId, userId: { in: userIds } },
        select: { userId: true },
      })
    ).map((e) => e.userId),
  );

  for (const row of rows) {
    if (!EMAIL_RE.test(row.email)) {
      results.push({ email: row.email || "(空白)", status: "invalid", detail: "email 格式錯誤" });
      continue;
    }
    if (seen.has(row.email)) {
      results.push({ email: row.email, status: "invalid", detail: "名單內重複，已略過" });
      continue;
    }
    seen.add(row.email);

    const profile = profileMap.get(row.email);
    if (!profile) {
      results.push({ email: row.email, status: "notfound", detail: "查無會員，請先批次匯入" });
      continue;
    }
    if (enrolled.has(profile.id)) {
      results.push({ email: row.email, status: "already", detail: "本來就有觀看權限" });
      continue;
    }

    try {
      // upsert + @@unique(userId, courseId) 雙重保險，重跑不會出錯
      await prisma.enrollment.upsert({
        where: { userId_courseId: { userId: profile.id, courseId } },
        update: {},
        create: { userId: profile.id, courseId },
      });
      results.push({ email: row.email, status: "enrolled" });
    } catch (e) {
      results.push({
        email: row.email,
        status: "error",
        detail: e instanceof Error ? e.message : "未知錯誤",
      });
    }
  }

  const c = (s: BatchRowResult["status"]) => results.filter((r) => r.status === s).length;
  return {
    done: true,
    summary: `「${course.title}」開通完成：成功 ${c("enrolled")}、已有權限 ${c("already")}、查無會員 ${c("notfound")}、格式錯誤 ${c("invalid")}、失敗 ${c("error")}`,
    results,
  };
}
