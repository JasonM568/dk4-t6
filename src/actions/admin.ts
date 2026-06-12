"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import {
  getProfileRole,
  getProfilesByEmails,
  listProfiles,
  createMember,
  setUserPassword,
  uploadCourseImage,
  uploadCourseMaterial,
} from "@/lib/supabase/admin";
import { toSlideEmbedUrl } from "@/lib/embed";
import { buildBroadcastHtml, sendBroadcast } from "@/lib/email/broadcast";
import { executeBroadcast } from "@/lib/email/dispatch";
import { isAdminRole } from "@/lib/auth/role";
import { extractYoutubeId } from "@/lib/youtube";
import { setPageEnabled, type SitePageKey } from "@/lib/site-pages";
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
  courseCode: z
    .string()
    .transform((v) => v.trim() || null)
    .nullable(),
  listPrice: z
    .union([
      z.literal("").transform(() => null),
      z.coerce
        .number({ message: "建議售價要填數字" })
        .int("建議售價要填整數")
        .min(0, "建議售價不能是負數"),
    ])
    .nullable(),
  price: z.coerce.number({ message: "優惠價要填數字" }).int("優惠價要填整數").min(0, "優惠價不能是負數"),
  isPublished: z.coerce.boolean(),
}).refine((d) => d.listPrice == null || d.listPrice >= d.price, {
  message: "建議售價要大於或等於優惠價",
  path: ["listPrice"],
});

export type CourseFormState = { error?: string } | null;

// 把表單內容轉成 schema 輸入（trim + slug 自動轉小寫，減少驗證失敗）
function courseInput(formData: FormData) {
  return {
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    coverImage: String(formData.get("coverImage") ?? "").trim(),
    courseCode: String(formData.get("courseCode") ?? ""),
    listPrice: String(formData.get("listPrice") ?? "").trim(),
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
    const categoryIds = formData.getAll("categoryIds").map(String);
    await prisma.course.create({
      data: {
        ...parsed.data,
        coverImage: images.coverImage,
        introImages: images.introImages,
        categories: { connect: categoryIds.map((cid) => ({ id: cid })) },
      },
    });
  } catch (e) {
    // slug 是 @unique，撞名給友善訊息
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      if (e.message.includes("courseCode")) {
        return { error: `課程編號「${parsed.data.courseCode}」已被其他課程使用，請換一個` };
      }
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
    const categoryIds = formData.getAll("categoryIds").map(String);
    await prisma.course.update({
      where: { id },
      data: {
        ...parsed.data,
        coverImage: images.coverImage,
        introImages: images.introImages,
        categories: { set: categoryIds.map((cid) => ({ id: cid })) },
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      if (e.message.includes("courseCode")) {
        return { error: `課程編號「${parsed.data.courseCode}」已被其他課程使用，請換一個` };
      }
      return { error: `slug「${parsed.data.slug}」已被其他課程使用，請換一個` };
    }
    throw e;
  }
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
  redirect("/admin/courses");
}

/** 課程上移/下移：以目前顯示順序重新編號後與鄰居交換 */
export async function moveCourse(courseId: string, direction: "up" | "down") {
  await requireAdmin();

  const courses = await prisma.course.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  const idx = courses.findIndex((c) => c.id === courseId);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= courses.length) return;

  [courses[idx], courses[swap]] = [courses[swap], courses[idx]];
  await prisma.$transaction(
    courses.map((c, i) =>
      prisma.course.update({ where: { id: c.id }, data: { sortOrder: i } }),
    ),
  );

  revalidatePath("/admin/courses");
  revalidatePath("/courses");
  revalidatePath("/");
}

// 排序相關 action 共用：依指定 id 順序重寫所有 sortOrder
async function renumberCourses(orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.course.update({ where: { id }, data: { sortOrder: i } }),
    ),
  );
  revalidatePath("/admin/courses");
  revalidatePath("/courses");
  revalidatePath("/");
}

/** 課程置頂：移到最前，其餘順序不變 */
export async function pinCourseToTop(courseId: string) {
  await requireAdmin();
  const courses = await prisma.course.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  const rest = courses.map((c) => c.id).filter((id) => id !== courseId);
  if (rest.length === courses.length) return; // id 不存在
  await renumberCourses([courseId, ...rest]);
}

/** 拖曳排序：前端傳完整新順序；id 集合必須與現有課程一致才寫入 */
export async function reorderCoursesAction(orderedIds: string[]) {
  await requireAdmin();
  const courses = await prisma.course.findMany({ select: { id: true } });
  const valid =
    courses.length === orderedIds.length &&
    new Set(orderedIds).size === orderedIds.length &&
    courses.every((c) => orderedIds.includes(c.id));
  if (!valid) return; // 名單不一致（可能有人同時新增/刪除課程）→ 放棄這次排序
  await renumberCourses(orderedIds);
}

/** 複製課程：連同章節/講義/分類；新課程未上架、slug 加 -copy、課程編號留空 */
export async function duplicateCourse(courseId: string) {
  await requireAdmin();
  const src = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      lessons: true,
      materials: true,
      categories: { select: { id: true } },
    },
  });
  if (!src) return;

  // slug 唯一：basename-copy、basename-copy-2…
  let slug = `${src.slug}-copy`;
  for (
    let n = 2;
    await prisma.course.findUnique({ where: { slug }, select: { id: true } });
    n++
  ) {
    slug = `${src.slug}-copy-${n}`;
  }

  const copy = await prisma.course.create({
    data: {
      slug,
      title: `${src.title}（複製）`,
      description: src.description,
      coverImage: src.coverImage,
      introImages: src.introImages,
      listPrice: src.listPrice,
      price: src.price,
      isPublished: false,
      courseCode: null,
      categories: { connect: src.categories },
      lessons: {
        create: src.lessons.map((l) => ({
          title: l.title,
          youtubeId: l.youtubeId,
          slideUrl: l.slideUrl,
          order: l.order,
          durationSec: l.durationSec,
        })),
      },
      materials: {
        create: src.materials.map((m) => ({ title: m.title, url: m.url })),
      },
    },
  });

  // 複本排在原課程正後方
  const courses = await prisma.course.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  const rest = courses.map((c) => c.id).filter((id) => id !== copy.id);
  const at = rest.indexOf(courseId);
  rest.splice(at + 1, 0, copy.id);
  await renumberCourses(rest);

  // 直接進複本編輯頁，接著改標題/編號/內容
  redirect(`/admin/courses/${copy.id}`);
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
  // 容錯：貼完整網址或 iframe 嵌入碼也能自動抽出 11 碼影片 ID
  const youtubeId = extractYoutubeId(String(formData.get("youtubeId") ?? ""));
  const order = Number(formData.get("order") ?? 0);
  const durationSec = formData.get("durationSec")
    ? Number(formData.get("durationSec"))
    : null;
  // 線上簡報：分享網址自動轉嵌入格式（Google Slides/Canva）
  const slideUrl = toSlideEmbedUrl(String(formData.get("slideUrl") ?? "")) || null;
  if (!title || !youtubeId) return;
  await prisma.lesson.create({
    data: { courseId, title, youtubeId, slideUrl, order, durationSec },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function updateLesson(
  lessonId: string,
  courseId: string,
  formData: FormData,
) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  // 與 addLesson 相同容錯：網址/嵌入碼/純 ID 皆可
  const youtubeId = extractYoutubeId(String(formData.get("youtubeId") ?? ""));
  const order = Number(formData.get("order") ?? 0);
  const durationSec = formData.get("durationSec")
    ? Number(formData.get("durationSec"))
    : null;
  const slideUrl = toSlideEmbedUrl(String(formData.get("slideUrl") ?? "")) || null;
  if (!title || !youtubeId) return;
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { title, youtubeId, slideUrl, order, durationSec },
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

// ───────────────────────── 課程講義 ─────────────────────────

export type MaterialState = { error?: string } | null;

/** 新增講義：上傳檔案（優先）或填外部網址 */
export async function addMaterialAction(
  courseId: string,
  _prev: MaterialState,
  formData: FormData,
): Promise<MaterialState> {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "請填寫講義名稱" };

  let url = String(formData.get("url") ?? "").trim();
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const up = await uploadCourseMaterial(file);
    if (!up.ok) return { error: up.error };
    url = up.url;
  }
  if (!url) return { error: "請上傳檔案或填寫外部網址" };

  await prisma.courseMaterial.create({ data: { courseId, title, url } });
  revalidatePath(`/admin/courses/${courseId}`);
  return null;
}

export async function deleteMaterial(materialId: string, courseId: string) {
  await requireAdmin();
  await prisma.courseMaterial.delete({ where: { id: materialId } });
  revalidatePath(`/admin/courses/${courseId}`);
}

// ─────────────────── 會員觀看權限手動編輯 ───────────────────

export type EnrollmentEditState = { error?: string; success?: string } | null;

/** 手動開通單一課程權限（orderId 留空 = 標示「手動開通」） */
export async function grantEnrollmentAction(
  userId: string,
  _prev: EnrollmentEditState,
  formData: FormData,
): Promise<EnrollmentEditState> {
  await requireAdmin();

  const courseId = String(formData.get("courseId") ?? "");
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { error: "請選擇課程" };

  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: {},
    create: { userId, courseId },
  });

  revalidatePath(`/admin/members/${userId}`);
  return { success: `已開通「${course.title}」` };
}

/** 移除單一課程權限（客戶端先 confirm） */
export async function revokeEnrollment(userId: string, courseId: string) {
  await requireAdmin();
  await prisma.enrollment.deleteMany({ where: { userId, courseId } });
  revalidatePath(`/admin/members/${userId}`);
}

// ─────────────────── 未登入會員批次設密碼 ───────────────────

export type BulkPasswordState = { error?: string; success?: string } | null;

/** 為勾選的會員批次重設密碼（覆蓋原密碼；用於從未登入的會員） */
export async function bulkSetPasswordAction(
  _prev: BulkPasswordState,
  formData: FormData,
): Promise<BulkPasswordState> {
  await requireAdmin();

  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const password = String(formData.get("password") ?? "").trim();

  if (userIds.length === 0) return { error: "請至少勾選一位會員" };
  if (password.length < 6) return { error: "密碼至少 6 字元" };
  if (userIds.length > 300) return { error: "一次最多 300 位，請分批" };

  let ok = 0;
  let fail = 0;
  for (const id of userIds) {
    if (await setUserPassword(id, password)) ok++;
    else fail++;
  }

  revalidatePath("/admin/members/inactive");
  if (fail > 0) return { error: `完成但有失敗：成功 ${ok}、失敗 ${fail}` };
  return { success: `已為 ${ok} 位會員設定新密碼，可用群發通知告知學員` };
}

// ───────────────────────── 群發通知 ─────────────────────────

export type BroadcastState = { error?: string; success?: string } | null;

/** 群發通知：mode=test 只寄給操作的管理員本人；mode=all 寄給全部會員並留紀錄。
 *  填了「預設發送時間」則建立排程紀錄，由 cron（/api/cron/broadcast，每 5 分鐘）到期寄出 */
export async function sendBroadcastAction(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  await requireAdmin();
  const admin = await getAuthUser();

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "");
  const mode = String(formData.get("mode") ?? "test");
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();

  if (!subject) return { error: "請填寫主旨" };
  if (!body) return { error: "請填寫內文" };

  const course = courseId
    ? await prisma.course.findUnique({
        where: { id: courseId },
        select: {
          title: true,
          slug: true,
          coverImage: true,
          price: true,
          listPrice: true,
        },
      })
    : null;

  // 測試模式：只寄給自己（排程時間不影響測試信，立即寄）
  if (mode === "test") {
    if (!admin?.email) return { error: "讀不到你的 email，無法寄測試信" };
    const html = buildBroadcastHtml(body, course);
    const r = await sendBroadcast([admin.email], `[測試] ${subject}`, html);
    return r.failed > 0
      ? { error: `測試信寄送失敗：${r.error ?? "未知錯誤"}` }
      : { success: `測試信已寄到 ${admin.email}，請收信確認版面` };
  }

  // 排程模式：datetime-local 值無時區，固定以台灣時間解讀
  if (scheduledAtRaw) {
    const scheduledAt = new Date(`${scheduledAtRaw}:00+08:00`);
    if (isNaN(scheduledAt.getTime())) return { error: "發送時間格式不正確" };
    if (scheduledAt.getTime() < Date.now() + 60_000) {
      return { error: "發送時間需晚於現在（要立即寄出請清空發送時間）" };
    }
    await prisma.emailBroadcast.create({
      data: {
        subject,
        body,
        courseId: courseId || null,
        status: "SCHEDULED",
        scheduledAt,
        sentBy: admin?.email ?? null,
      },
    });
    revalidatePath("/admin/broadcast");
    const shown = scheduledAt.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
    return {
      success: `已排程：${shown} 寄出（實際寄出時間最多晚 5 分鐘；寄送名單以當下會員為準）`,
    };
  }

  // 立即群發：先建紀錄再寄，結果回寫同一筆
  const record = await prisma.emailBroadcast.create({
    data: {
      subject,
      body,
      courseId: courseId || null,
      status: "SENDING",
      sentBy: admin?.email ?? null,
    },
  });
  const r = await executeBroadcast(record.id);

  revalidatePath("/admin/broadcast");
  if (r.sent === 0) return { error: `群發失敗：${r.error ?? "未知錯誤"}` };
  if (r.failed > 0) {
    return {
      error: `寄送完成但有失敗：成功 ${r.sent}、失敗 ${r.failed}（${r.error ?? ""}）`,
    };
  }
  return { success: `群發完成！已寄給 ${r.sent} 位會員` };
}

/** 取消排程中的群發（只動 SCHEDULED 狀態，已寄出/處理中不受影響） */
export async function cancelScheduledBroadcast(id: string) {
  await requireAdmin();
  await prisma.emailBroadcast.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELED" },
  });
  revalidatePath("/admin/broadcast");
}

// ───────────────────────── 課程分類 ─────────────────────────

export async function addCategory(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // 名稱唯一，重複就略過（不炸頁）
  await prisma.category
    .create({ data: { name } })
    .catch(() => undefined);
  revalidatePath("/admin/categories");
}

export async function updateCategory(id: string, formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.category
    .update({ where: { id }, data: { name } })
    .catch(() => undefined);
  revalidatePath("/admin/categories");
}

export async function deleteCategory(id: string) {
  await requireAdmin();
  // 多對多關聯只會解除課程的分類標記，不會動到課程本身
  await prisma.category.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/categories");
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

// 把貼上的名單拆成列（逗號/全形逗號/Tab 分隔），欄位順序不限，自動辨識：
// - 符合 email 格式的欄位 → email
// - 含中文的欄位 → 姓名
// - 其餘欄位 → 密碼（單一非中文欄位時：≥6 碼且含數字當密碼，否則當英文姓名）
// 空行與 # 開頭的註解行略過
function parseRows(raw: string): { email: string; name: string; password: string }[] {
  const CJK = /[一-鿿]/;
  return raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line
        .split(/[,\t，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const email = (parts.find((p) => EMAIL_RE.test(p)) ?? "").toLowerCase();
      const rest = parts.filter((p) => !EMAIL_RE.test(p));

      let name = "";
      let password = "";
      const cjkField = rest.find((p) => CJK.test(p));
      if (cjkField) {
        name = cjkField;
        password = rest.find((p) => p !== cjkField) ?? "";
      } else if (rest.length >= 2) {
        [name, password] = rest;
      } else if (rest.length === 1) {
        if (rest[0].length >= 6 && /\d/.test(rest[0])) password = rest[0];
        else name = rest[0];
      }
      return { email, name, password };
    });
}

/** 單筆手動新增會員 */
export async function addMemberAction(
  _prev: EnrollmentEditState,
  formData: FormData,
): Promise<EnrollmentEditState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();

  if (!name) return { error: "請填寫姓名" };
  if (!EMAIL_RE.test(email)) return { error: "Email 格式錯誤" };
  if (password.length < 6) return { error: "密碼至少 6 字元" };

  const created = await createMember({ email, password, displayName: name });
  if (!created.ok) {
    return created.reason === "exists"
      ? { error: `${email} 已是會員，不需重複建立` }
      : { error: `建立失敗：${created.message ?? "未知錯誤"}` };
  }

  revalidatePath("/admin/members");
  return { success: `已建立會員 ${name}（${email}）` };
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

// ── 分頁管理（前台導覽分頁開關）──

export async function togglePageAction(key: SitePageKey, enabled: boolean) {
  await requireAdmin();
  await setPageEnabled(key, enabled);
  // navbar 在 root layout，全站重新驗證
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
}
