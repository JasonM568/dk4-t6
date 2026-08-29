"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import {
  getProfile,
  getProfilesByEmails,
  findAuthUserIdByEmail,
  listProfiles,
  createMember,
  setUserPassword,
  createCourseImageSignedUpload,
  uploadCourseMaterial,
} from "@/lib/supabase/admin";
import { toSlideEmbedUrl } from "@/lib/embed";
import { Prisma } from "@prisma/client";
import {
  buildBroadcastHtml,
  sendBroadcast,
  applyMergeTags,
  type FailedRecipient,
} from "@/lib/email/broadcast";
import {
  executeBroadcast,
  previewGroupAudience,
  previewSessionAudience,
} from "@/lib/email/dispatch";
import {
  EMPTY_GROUP_AUDIENCE_PREVIEW,
  EMPTY_SESSION_AUDIENCE_PREVIEW,
  type GroupAudiencePreview,
  type SessionAudiencePreview,
} from "@/lib/email/audience";
import { FOLLOWUP_FILTER_LABEL, isFollowUpFilter } from "@/lib/email/followup";
import { resolveMessageType } from "@/lib/email/message-type";
import { inspectBroadcastDraft } from "@/lib/email/preflight";
import { buildUnsubscribePageUrl } from "@/lib/email/unsubscribe";
import { isAdminRole } from "@/lib/auth/role";
import { extractYoutubeId } from "@/lib/youtube";
import { setPageEnabled, type SitePageKey } from "@/lib/site-pages";
import { TRACKING_KEYS } from "@/lib/tracking";
import { decodeCsvBuffer } from "@/lib/csv";
import { parseOrderFile } from "@/lib/session-import";
import { normalizeContactPhone } from "@/lib/sms/phone";
import { requireEditor, requireFullAdmin } from "@/lib/auth/staff";
import { autoEnrollGroupCourses } from "@/lib/zone-enroll";
import {
  recordPendingEnrollment,
  claimPendingEnrollments,
  markPendingClaimed,
} from "@/lib/pending-enroll";
import { findIdentityConflictEmails } from "@/lib/course-roster";
import { prisma } from "@/lib/db";

// 後台 action 守門分三級（定義見 src/lib/auth/staff.ts）：
//   requireEditor    編輯/操作/匯出 → admin|operator（總教練唯讀被擋）
//   requireFullAdmin 分頁管理、權限管理 → 僅 admin
// 查看頁面的守門在各 page 與 (admin)/layout.tsx

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
  unpublishAt: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "下架時間格式不正確")
    .transform((v) => (v ? new Date(`${v}:00+08:00`) : null))
    .nullable(),
  // 所屬企業專區；空字串（一般課程）→ null
  groupId: z
    .string()
    .transform((v) => v.trim() || null)
    .nullable(),
  // 專區限時免開通觀看（日期，含當天整天；空 = 不開放，一律手動開通）
  openToGroupUntil: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "開放日期格式不正確")
    .transform((v) => (v ? new Date(`${v}T23:59:59+08:00`) : null))
    .nullable(),
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
    unpublishAt: String(formData.get("unpublishAt") ?? "").trim(),
    groupId: String(formData.get("groupId") ?? ""),
    openToGroupUntil: String(formData.get("openToGroupUntil") ?? "").trim(),
  };
}

function firstZodError(parsed: { error: z.ZodError }): string {
  return parsed.error.issues[0]?.message ?? "輸入內容有誤，請檢查後再試";
}

// 圖片改由瀏覽器直傳 Supabase Storage（見 createCourseImageSignedUpload）。
// 表單送出時，封面與介紹圖都已是公開網址字串，這裡只負責讀取與排序：
// - coverImage：courseSchema 已驗證（網址或空字串）
// - introImages：依使用者在表單上排好的順序，逐筆 hidden input 送來
function introImagesFromForm(formData: FormData): string[] {
  return formData.getAll("introImages").map(String).filter(Boolean);
}

// 給課程表單呼叫：要求一個簽名上傳 URL（瀏覽器拿到後直傳圖片到 Storage）。
// 守門 requireEditor，避免被未授權者拿來產生上傳憑證。
export async function requestCourseImageUploadUrl(
  fileType: string,
  prefix:
    | "cover"
    | "intro"
    | "webinar"
    | "page"
    | "broadcast"
    | "brief"
    | "article"
    | "session" = "intro",
) {
  await requireEditor();
  return createCourseImageSignedUpload(fileType, prefix);
}

export async function createCourse(
  _prev: CourseFormState,
  formData: FormData,
): Promise<CourseFormState> {
  await requireEditor();
  const parsed = courseSchema.safeParse(courseInput(formData));
  if (!parsed.success) return { error: firstZodError(parsed) };

  const introImages = introImagesFromForm(formData);

  try {
    const categoryIds = formData.getAll("categoryIds").map(String);
    await prisma.course.create({
      data: {
        ...parsed.data,
        introImages,
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
  revalidatePath("/");
  revalidatePath("/courses");
  redirect("/admin/courses");
}

export async function updateCourse(
  id: string,
  _prev: CourseFormState,
  formData: FormData,
): Promise<CourseFormState> {
  await requireEditor();
  const parsed = courseSchema.safeParse(courseInput(formData));
  if (!parsed.success) return { error: firstZodError(parsed) };

  const introImages = introImagesFromForm(formData);

  try {
    const categoryIds = formData.getAll("categoryIds").map(String);
    await prisma.course.update({
      where: { id },
      data: {
        ...parsed.data,
        introImages,
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
  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath(`/courses/${parsed.data.slug}`);
  redirect("/admin/courses");
}

/** 課程上移/下移：以目前顯示順序重新編號後與鄰居交換 */
export async function moveCourse(courseId: string, direction: "up" | "down") {
  await requireEditor();

  // Serializable 確保讀取與寫入之間不會被其他 transaction 插入，防止並發排序衝突
  await prisma.$transaction(async (tx) => {
    const courses = await tx.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    const idx = courses.findIndex((c) => c.id === courseId);
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= courses.length) return;

    [courses[idx], courses[swap]] = [courses[swap], courses[idx]];
    await Promise.all(
      courses.map((c, i) =>
        tx.course.update({ where: { id: c.id }, data: { sortOrder: i } }),
      ),
    );
  }, { isolationLevel: "Serializable" });

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
  await requireEditor();
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
  await requireEditor();
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
  await requireEditor();
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
      // 專區歸屬必須跟著複製，否則專區課的複本會變成公開課
      groupId: src.groupId,
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
  await requireEditor();
  await prisma.course.delete({ where: { id } });
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function addLesson(courseId: string, formData: FormData) {
  await requireEditor();
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
  await requireEditor();
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
  await requireEditor();
  await prisma.lesson.delete({ where: { id: lessonId } });
  revalidatePath(`/admin/courses/${courseId}`);
}

// ───────────────────────── 課程講義 ─────────────────────────

export type MaterialState = { error?: string } | null;

/** 新增講義：上傳檔案（優先）或填外部網址 */
export async function addMaterialAction(
  courseId: string,
  _prev: MaterialState,
  formData: FormData,
): Promise<MaterialState> {
  await requireEditor();

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
  await requireEditor();
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
  await requireEditor();

  const profile = await getProfile(userId);
  if (!profile) return { error: "找不到此會員" };

  const courseId = String(formData.get("courseId") ?? "");
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { error: "請選擇課程" };

  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: {},
    create: { userId, courseId, source: "MANUAL" },
  });

  revalidatePath(`/admin/members/${userId}`);
  return { success: `已開通「${course.title}」` };
}

/** 移除單一課程權限（客戶端先 confirm） */
export async function revokeEnrollment(userId: string, courseId: string) {
  await requireEditor();
  const profile = await getProfile(userId);
  if (!profile) return;
  await prisma.enrollment.deleteMany({ where: { userId, courseId } });
  revalidatePath(`/admin/members/${userId}`);
}

export type RevokeState = { error?: string; success?: string } | null;

/** 觀看權限名單頁：移除一筆待開通存底（誤貼的 email 等，客戶端先 confirm） */
export async function deletePendingEnrollmentAction(courseId: string, id: string) {
  await requireEditor();
  await prisma.pendingEnrollment
    .deleteMany({ where: { id, courseId } })
    .catch(() => undefined);
  revalidatePath(`/admin/courses/${courseId}/members`);
}

/** 觀看權限名單頁：批次移除勾選會員的觀看權限 */
export async function batchRevokeEnrollmentAction(
  courseId: string,
  _prev: RevokeState,
  formData: FormData,
): Promise<RevokeState> {
  await requireEditor();
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  if (userIds.length === 0) return { error: "請至少勾選一位會員" };
  const r = await prisma.enrollment.deleteMany({
    where: { courseId, userId: { in: userIds } },
  });
  revalidatePath(`/admin/courses/${courseId}/members`);
  return { success: `已移除 ${r.count} 位會員的觀看權限` };
}

// ─────────────────── 未登入會員批次設密碼 ───────────────────

export type BulkPasswordState = { error?: string; success?: string } | null;

/** 密碼重設共用防線：逐筆取 profile，拒絕 admin 帳號、操作者本人、查無帳號。
 *  回傳 null = 可重設；否則回拒絕原因（會寫進稽核紀錄）。 */
async function passwordResetGuard(
  targetId: string,
  actorId: string,
): Promise<string | null> {
  if (targetId === actorId) return "拒絕：不可重設自己的密碼";
  const profile = await getProfile(targetId);
  if (!profile) return "拒絕：查無此會員";
  if (isAdminRole(profile.role)) return "拒絕：不可重設管理員密碼";
  return null;
}

async function auditPasswordReset(
  action: "PASSWORD_RESET" | "PASSWORD_RESET_BULK",
  actor: { id: string; email?: string | null },
  targetId: string,
  success: boolean,
  detail?: string,
) {
  await prisma.adminAuditLog
    .create({
      data: {
        action,
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        targetId,
        success,
        detail: detail ?? null,
      },
    })
    .catch((e) => console.error("[audit] 稽核寫入失敗：", e?.message));
}

/** 為勾選的會員批次重設密碼（覆蓋原密碼；用於從未登入的會員）。
 *  僅限管理員：密碼重設等同接管帳號，不開放 operator（防越權）。 */
export async function bulkSetPasswordAction(
  _prev: BulkPasswordState,
  formData: FormData,
): Promise<BulkPasswordState> {
  await requireFullAdmin();

  const userIds = [
    ...new Set(formData.getAll("userIds").map(String).filter(Boolean)),
  ];
  const password = String(formData.get("password") ?? "").trim();

  if (userIds.length === 0) return { error: "請至少勾選一位會員" };
  if (password.length < 6) return { error: "密碼至少 6 字元" };
  if (userIds.length > 300) return { error: "一次最多 300 位，請分批" };

  const adminUser = await getAuthUser();
  if (!adminUser) return { error: "登入狀態失效，請重新登入" };

  let ok = 0;
  const rejected: string[] = [];
  let fail = 0;
  for (const id of userIds) {
    // 不信任前端傳入的 userIds：server 端逐筆驗證身分再動手
    const reason = await passwordResetGuard(id, adminUser.id);
    if (reason) {
      rejected.push(id);
      await auditPasswordReset("PASSWORD_RESET_BULK", adminUser, id, false, reason);
      continue;
    }
    if (await setUserPassword(id, password)) {
      ok++;
      await recordMemberPassword(id, password, adminUser.email ?? null);
      await auditPasswordReset("PASSWORD_RESET_BULK", adminUser, id, true);
    } else {
      fail++;
      await auditPasswordReset(
        "PASSWORD_RESET_BULK",
        adminUser,
        id,
        false,
        "Auth 更新失敗",
      );
    }
  }

  revalidatePath("/admin/members/inactive");
  const parts = [`成功 ${ok}`];
  if (rejected.length > 0) parts.push(`拒絕 ${rejected.length}（管理員/本人/查無帳號）`);
  if (fail > 0) parts.push(`失敗 ${fail}`);
  if (rejected.length > 0 || fail > 0) return { error: `完成：${parts.join("、")}` };
  return { success: `已為 ${ok} 位會員設定新密碼，可用群發通知告知學員` };
}

export type ResetPasswordState = { error?: string; success?: string } | null;

/** 單筆重設會員密碼（會員列表用），並記錄初始密碼供後台備查。
 *  僅限管理員（同批次重設）；拒絕 admin 帳號與操作者本人。 */
export async function resetMemberPasswordAction(
  userId: string,
  formData: FormData,
): Promise<ResetPasswordState> {
  await requireFullAdmin();
  const adminUser = await getAuthUser();
  if (!adminUser) return { error: "登入狀態失效，請重新登入" };

  const reason = await passwordResetGuard(userId, adminUser.id);
  if (reason) {
    await auditPasswordReset("PASSWORD_RESET", adminUser, userId, false, reason);
    return { error: reason };
  }
  const password = String(formData.get("password") ?? "").trim();
  if (password.length < 6) return { error: "密碼至少 6 字元" };

  const ok = await setUserPassword(userId, password);
  await auditPasswordReset(
    "PASSWORD_RESET",
    adminUser,
    userId,
    ok,
    ok ? undefined : "Auth 更新失敗",
  );
  if (!ok) return { error: "重設失敗（Auth 更新錯誤），請稍後再試" };

  await recordMemberPassword(userId, password, adminUser.email ?? null);
  revalidatePath("/admin/members");
  return { success: "已重設密碼" };
}

export type AddToGroupState = { error?: string; success?: string } | null;

/** 勾選會員 → 加入名單群組（建新群組或併入既有），用 profiles 的 email/姓名 */
export async function addMembersToGroupAction(
  _prev: AddToGroupState,
  formData: FormData,
): Promise<AddToGroupState> {
  await requireEditor();
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const newName = String(formData.get("newName") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "");
  if (userIds.length === 0) return { error: "請至少勾選一位會員" };

  // 用 userId 反查 email/姓名
  const profiles = await listProfiles();
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const rows = userIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.email)
    .map((p) => ({ email: p.email as string, name: p.display_name ?? undefined }));
  if (rows.length === 0) return { error: "勾選的會員查無 email" };

  // 修正：選了既有群組就「絕對」用既有（groupId 優先），只有沒選既有時才用名稱建新，
  // 杜絕「想加既有卻因名稱沒對上而誤建新群組」。
  let targetId = "";
  let groupName = "";
  if (groupId) {
    const g = await prisma.mailGroup.findUnique({ where: { id: groupId } });
    if (!g) return { error: "找不到選擇的群組" };
    targetId = g.id;
    groupName = g.name;
  } else if (newName) {
    const group = await prisma.mailGroup.upsert({
      where: { name: newName },
      update: {},
      create: { name: newName },
    });
    targetId = group.id;
    groupName = group.name;
  } else {
    return { error: "請選擇既有群組或填寫新群組名稱" };
  }

  const added = await addRowsToGroup(targetId, rows);
  revalidatePath("/admin/broadcast/groups");
  revalidatePath(`/admin/broadcast/groups/${targetId}`);
  revalidatePath("/admin/members");
  return {
    success: `已將 ${added} 位會員加入名單群組「${groupName}」${
      added < rows.length ? `（${rows.length - added} 位已在群組內略過）` : ""
    }`,
  };
}

export type GrantState = { error?: string; success?: string } | null;

/** 會員列表勾選會員 → 直接開通某課程「觀看權限」(Enrollment)，
 *  這跟「加入 EDM 名單群組」是兩回事：這個才會讓會員能看課程影片。 */
export async function grantCourseToMembersAction(
  _prev: GrantState,
  formData: FormData,
): Promise<GrantState> {
  await requireEditor();
  const userIds = [
    ...new Set(formData.getAll("userIds").map(String).filter(Boolean)),
  ];
  const courseId = String(formData.get("enrollCourseId") ?? "");
  if (userIds.length === 0) return { error: "請至少勾選一位會員" };
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { title: true },
  });
  if (!course) return { error: "請選擇要開通的課程" };

  // createMany + skipDuplicates：已開通的自動略過，count 為實際新增數
  const created = await prisma.enrollment.createMany({
    data: userIds.map((userId) => ({ userId, courseId, source: "MANUAL" })),
    skipDuplicates: true,
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/courses/${courseId}/members`);
  return {
    success: `已開通「${course.title}」觀看權限：新增 ${created.count} 位${
      created.count < userIds.length
        ? `（${userIds.length - created.count} 位原本就有，已略過）`
        : ""
    }`,
  };
}

// ───────────────────────── 群發通知 ─────────────────────────

export type BroadcastState = {
  error?: string;
  success?: string;
  broadcastId?: string; // 本次群發/排程的紀錄 id（手動名單存群組用）
  manualCount?: number; // 手動名單筆數（>0 時前端提醒「是否建立群組」）
} | null;

type BroadcastAudience = {
  error?: string;
  audienceData: {
    audienceType: string;
    groupId: string | null;
    groupIds: string[];
    sessionIds: string[];
    audienceLabel: string;
    manualRows: { email: string; name?: string }[] | undefined;
    sourceBroadcastId: string | null;
    followUpFilter: string | null;
  };
};

async function validateCodeCoverage(
  body: string,
  audience: string,
  sessionIds: string[],
  messageType: string,
): Promise<string | null> {
  if (!body.includes("{code}")) return null;
  if (audience !== "session") return "內文使用了 {code}，發送對象必須選擇「場次報名者」";
  const preview = await previewSessionAudience(
    sessionIds,
    messageType === "NOTICE" ? "NOTICE" : "MARKETING",
  );
  if (preview.sendableCount > preview.withCodeCount) {
    return `內文使用了 {code}，但可寄 ${preview.sendableCount} 人中只有 ${preview.withCodeCount} 人的場次已設定上課碼`;
  }
  return null;
}

/** 解析群發表單的發送對象（sendBroadcastAction / updateBroadcastAction 共用）。
 *  lenient = 草稿模式：群組不存在/名單空也照存，之後編輯再補 */
async function resolveBroadcastAudience(
  audience: string,
  groupIds: string[],
  sessionIds: string[],
  manualRaw: string,
  lenient = false,
  followUp?: { sourceBroadcastId: string; filter: string },
): Promise<BroadcastAudience> {
  let audienceType = "ALL";
  let audienceLabel = "全部會員";
  let audienceGroupId: string | null = null;
  let audienceGroupIds: string[] = [];
  let audienceSessionIds: string[] = [];
  let manualRows: { email: string; name?: string }[] | undefined;
  let sourceBroadcastId: string | null = null;
  let followUpFilter: string | null = null;
  const emptyAudience = {
    audienceType,
    groupId: null,
    groupIds: [],
    sessionIds: [],
    audienceLabel: "",
    manualRows,
    sourceBroadcastId: null,
    followUpFilter: null,
  };

  if (audience === "followup") {
    // 跟進信：名單於寄出當下從來源群發的成效事件解析（dispatch.ts resolveRecipients）
    audienceType = "FOLLOWUP";
    sourceBroadcastId = followUp?.sourceBroadcastId || null;
    followUpFilter = followUp?.filter || null;
    if (!sourceBroadcastId || !followUpFilter || !isFollowUpFilter(followUpFilter)) {
      if (!lenient)
        return { error: "跟進信缺少來源群發或跟進條件", audienceData: emptyAudience };
      audienceLabel = "跟進：未驗證來源";
    } else {
      const src = await prisma.emailBroadcast.findUnique({
        where: { id: sourceBroadcastId },
        select: { subject: true, status: true, recipients: true },
      });
      if (!lenient) {
        if (!src)
          return { error: "跟進來源群發不存在", audienceData: emptyAudience };
        if (src.status !== "SENT")
          return {
            error: "只能對已寄出（SENT）的群發建立跟進信",
            audienceData: emptyAudience,
          };
        if (followUpFilter === "NOT_OPENED" && src.recipients.length === 0)
          return {
            error: "來源群發沒有收件名單快照（舊紀錄），無法建立未開信者跟進",
            audienceData: emptyAudience,
          };
      }
      audienceLabel = `跟進：${FOLLOWUP_FILTER_LABEL[followUpFilter]}（來源：${src?.subject ?? "（已不存在）"}）`;
    }
  } else if (audience === "group") {
    // 可複選：寄出當下取所選群組的成員聯集並以 email 去重（dispatch.ts resolveRecipients）
    audienceType = "GROUP";
    const ids = [...new Set(groupIds.filter(Boolean))];
    const found = ids.length
      ? await prisma.mailGroup.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, _count: { select: { members: true } } },
        })
      : [];
    // findMany 不保證順序：一律照勾選順序排，標籤文字與去重的姓名優先序才對得起來
    const byId = new Map(found.map((g) => [g.id, g]));
    const picked = ids.map((id) => byId.get(id)).filter((g) => !!g);

    if (picked.length === 0) {
      if (!lenient)
        return {
          error: "請至少勾選一個名單群組",
          audienceData: { ...emptyAudience, audienceType },
        };
      audienceLabel = "群組：未選擇";
    } else {
      // 勾選後群組被刪掉：寧可擋下重選，也不要默默少寄一整批人
      if (!lenient && picked.length < ids.length)
        return {
          error: `有 ${ids.length - picked.length} 個群組已不存在（可能剛被刪除），請重新勾選`,
          audienceData: { ...emptyAudience, audienceType },
        };
      // 成員數判總和而非逐組：五組裡有一組是空的，不該擋住整批寄送
      const total = picked.reduce((n, g) => n + g._count.members, 0);
      if (!lenient && total === 0)
        return {
          error: `所選群組（${picked.map((g) => g.name).join("、")}）都沒有成員，請先到名單群組加入名單`,
          audienceData: { ...emptyAudience, audienceType },
        };
      audienceGroupIds = picked.map((g) => g.id);
      audienceGroupId = audienceGroupIds[0]; // 舊欄位鏡射，未遷移的讀取端仍拿得到值
      const names = picked.map((g) => g.name);
      audienceLabel =
        names.length === 1
          ? `群組：${names[0]}` // 單選文案與改版前一字不差，歷史紀錄看起來才一致
          : `群組 ${names.length} 組（已去重）：${names.slice(0, 3).join("、")}${
              names.length > 3 ? ` 等${names.length}組` : ""
            }`;
    }
  } else if (audience === "session") {
    // 場次報名者：與簡訊模組共用同一份 SessionSignup 名單（訂單匯入一次，兩邊都能發）。
    // 名單於寄出當下解析（dispatch.ts resolveRecipients），這裡只驗場次存在與有無報名者。
    audienceType = "SESSION";
    const ids = [...new Set(sessionIds.filter(Boolean))];
    const found = ids.length
      ? await prisma.courseSession.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            title: true,
            // 已延期到別場的不算這場的人（與 dispatch 的名單條件一致）
            _count: { select: { signups: { where: { deferredToSessionId: null } } } },
          },
        })
      : [];
    // findMany 不保證順序：照勾選順序排，標籤文字與去重的姓名優先序才對得起來
    const byId = new Map(found.map((s) => [s.id, s]));
    const picked = ids.map((id) => byId.get(id)).filter((s) => !!s);

    if (picked.length === 0) {
      if (!lenient)
        return {
          error: "請至少勾選一個場次",
          audienceData: { ...emptyAudience, audienceType },
        };
      audienceLabel = "場次：未選擇";
    } else {
      // 勾選後場次被刪掉：寧可擋下重選，也不要默默少寄一整批人
      if (!lenient && picked.length < ids.length)
        return {
          error: `有 ${ids.length - picked.length} 個場次已不存在（可能剛被刪除），請重新勾選`,
          audienceData: { ...emptyAudience, audienceType },
        };
      const total = picked.reduce((n, s) => n + s._count.signups, 0);
      if (!lenient && total === 0)
        return {
          error: `所選場次（${picked.map((s) => s.title).join("、")}）都沒有報名者，請先到場次看板上傳訂單`,
          audienceData: { ...emptyAudience, audienceType },
        };
      audienceSessionIds = picked.map((s) => s.id);
      const titles = picked.map((s) => s.title);
      audienceLabel =
        titles.length === 1
          ? `場次：${titles[0]}`
          : `場次 ${titles.length} 場（已去重）：${titles.slice(0, 3).join("、")}${
              titles.length > 3 ? ` 等${titles.length}場` : ""
            }`;
    }
  } else if (audience === "manual" || audience === "members") {
    // members = 從會員清單勾選；名單同樣走 MANUAL 流程（寄送/明細/補寄/存群組共用）
    audienceType = "MANUAL";
    const seen = new Set<string>();
    manualRows = parseRows(manualRaw)
      .filter((r) => EMAIL_RE.test(r.email))
      .filter((r) => !seen.has(r.email) && seen.add(r.email))
      .map((r) => (r.name ? { email: r.email, name: r.name } : { email: r.email }));
    if (!lenient && manualRows.length === 0)
      return {
        error:
          audience === "members"
            ? "請至少勾選一位會員"
            : "手動名單沒有任何合法的 email",
        audienceData: { ...emptyAudience, audienceType, manualRows },
      };
    audienceLabel = `${audience === "members" ? "選取會員" : "手動名單"} ${manualRows.length} 筆`;
  }

  return {
    audienceData: {
      audienceType,
      groupId: audienceGroupId,
      groupIds: audienceGroupIds,
      sessionIds: audienceSessionIds,
      audienceLabel,
      manualRows: manualRows ?? undefined,
      sourceBroadcastId,
      followUpFilter,
    },
  };
}

/** 存成範本（mode=template，sendBroadcastAction / updateBroadcastAction 共用）：
 *  只存內容（主旨/內文/關聯課程），發送對象不存；同名範本覆蓋更新 */
async function saveMailTemplateFromForm(
  formData: FormData,
  adminEmail: string | null,
): Promise<BroadcastState> {
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "");
  const name = String(formData.get("templateName") ?? "").trim() || subject;
  if (!name) return { error: "請填寫範本名稱" };

  const existing = await prisma.mailTemplate.findUnique({ where: { name } });
  await prisma.mailTemplate.upsert({
    where: { name },
    update: { subject, body, courseId: courseId || null, createdBy: adminEmail },
    create: { name, subject, body, courseId: courseId || null, createdBy: adminEmail },
  });
  revalidatePath("/admin/broadcast");
  return {
    success: existing
      ? `已更新範本「${name}」（同名覆蓋）`
      : `已存成範本「${name}」，之後可在群發頁「常用範本」一鍵帶入`,
  };
}

/** 刪除 EDM 範本 */
export async function deleteMailTemplateAction(id: string) {
  await requireEditor();
  await prisma.mailTemplate.deleteMany({ where: { id } });
  revalidatePath("/admin/broadcast");
}

/** 複選名單群組的收件人數預覽（後台勾選當下即時試算）。
 *  刻意呼叫 dispatch 的 previewGroupAudience——與寄出走同一套去重與退訂過濾，
 *  預覽的「實際可寄 N 人」就是寄出後的 sentCount。 */
export async function previewGroupAudienceAction(
  groupIds: string[],
): Promise<GroupAudiencePreview> {
  await requireEditor();
  const ids = [...new Set((groupIds ?? []).map(String).filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return EMPTY_GROUP_AUDIENCE_PREVIEW;
  // 名單群組不得標履約通知（NOTICE_ALLOWED_AUDIENCES），試算固定走 MARKETING
  return previewGroupAudience(ids, "MARKETING");
}

/** 複選場次的收件人數預覽（勾選當下即時試算）。
 *  同樣呼叫 dispatch 的 previewSessionAudience——預覽與寄出走同一套解析，數字不會兩套。 */
export async function previewSessionAudienceAction(
  sessionIds: string[],
  messageType = "MARKETING",
): Promise<SessionAudiencePreview> {
  await requireEditor();
  const ids = [...new Set((sessionIds ?? []).map(String).filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return EMPTY_SESSION_AUDIENCE_PREVIEW;
  // 勾了「履約通知」就用 NOTICE 試算：畫面上的「扣除退訂 N 人」會跟著變，
  // 管理員看得到「勾這個框救回了幾個人」
  return previewSessionAudience(ids, messageType === "NOTICE" ? "NOTICE" : "MARKETING");
}

/** 群發通知：mode=test 只寄給操作的管理員本人；mode=draft 存草稿；mode=all 正式群發並留紀錄。
 *  mode=template 把主旨/內文/關聯課程存成範本（不寄信、不留群發紀錄）。
 *  填了「預設發送時間」則建立排程紀錄，由 cron（/api/cron/broadcast，每 5 分鐘）到期寄出 */
export async function sendBroadcastAction(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  await requireEditor();
  const admin = await getAuthUser();

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "");
  const mode = String(formData.get("mode") ?? "test");
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const audience = String(formData.get("audience") ?? "all"); // all | group | session | manual | members | followup
  // 名單群組可複選（checkbox 同名多值）；勾選順序即姓名優先序
  const groupIds = formData.getAll("groupIds").map(String).filter(Boolean);
  // 場次可複選（同上）；名單於寄出當下才解析，與簡訊模組共用同一份場次報名名單
  const sessionIds = formData.getAll("sessionIds").map(String).filter(Boolean);
  // 履約通知（課前通知）：只擋退信／檢舉，不被行銷退訂擋掉。比照簡訊需勾確認
  const wantsNotice = formData.get("isNotice") === "on";
  const noticeAck = formData.get("noticeAck") === "on";
  const manualRaw = String(
    formData.get(audience === "members" ? "memberList" : "manualList") ?? "",
  );
  const followUp =
    audience === "followup"
      ? {
          sourceBroadcastId: String(formData.get("sourceBroadcastId") ?? ""),
          filter: String(formData.get("followUpFilter") ?? ""),
        }
      : undefined;

  if (!subject) return { error: "請填寫主旨" };
  if (mode !== "draft" && !body) return { error: "請填寫內文" };

  // 履約通知 vs 行銷推播：決定寄出時退訂名單怎麼擋（dispatch.ts filterUnsubscribed）。
  // 草稿不擋（存了再回來補勾），但存進去的一律是已驗證過的值，不會有「草稿是 NOTICE、
  // 送出時才發現對象不合法」的落差。
  const notice = resolveMessageType(audience, wantsNotice, noticeAck);
  if (mode !== "draft" && notice.error) return { error: notice.error };
  const noticeFields = {
    messageType: notice.messageType,
    noticeAckBy:
      notice.messageType === "NOTICE" ? (admin?.email ?? null) : null,
  };
  if (mode !== "draft" && mode !== "template") {
    const preflight = inspectBroadcastDraft({ subject, body });
    if (preflight.errors.length > 0) return { error: preflight.errors.join("；") };
  }

  // 存成範本：只存內容，不寄信、不留群發紀錄
  if (mode === "template") {
    return saveMailTemplateFromForm(formData, admin?.email ?? null);
  }

  // 存草稿：只驗主旨，發送對象寬鬆解析（之後編輯再補）
  if (mode === "draft") {
    const { audienceData } = await resolveBroadcastAudience(
      audience,
      groupIds,
      sessionIds,
      manualRaw,
      true,
      followUp,
    );
    const scheduledAt = scheduledAtRaw
      ? new Date(`${scheduledAtRaw}:00+08:00`)
      : null;
    const record = await prisma.emailBroadcast.create({
      data: {
        subject,
        body,
        courseId: courseId || null,
        status: "DRAFT",
        scheduledAt: scheduledAt && !isNaN(scheduledAt.getTime()) ? scheduledAt : null,
        sentBy: admin?.email ?? null,
        ...audienceData,
        ...noticeFields,
      },
    });
    revalidatePath("/admin/broadcast");
    return {
      success: "草稿已儲存，可到下方寄送紀錄「繼續編輯」",
      broadcastId: record.id,
    };
  }

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

  // 測試模式：只寄給自己（發送對象與排程時間不影響測試信；不過濾退訂名單，版面所見即所寄）
  if (mode === "test") {
    if (!admin?.email) return { error: "讀不到你的 email，無法寄測試信" };
    // {code} 帶入真正的上課碼：測試信是版面確認的唯一管道，
    // 這裡留白會讓人以為功能壞了。多選場次時取第一場（示意用途）
    const testCode =
      audience === "session" && sessionIds.length > 0
        ? ((
            await prisma.courseSession.findUnique({
              where: { id: sessionIds[0] },
              select: { accessCode: true },
            })
          )?.accessCode ?? undefined)
        : undefined;
    const me = {
      email: admin.email,
      name: admin.displayName ?? undefined,
      code: testCode,
    };
    const r = await sendBroadcast([me], `[測試] ${subject}`, (rcpt) =>
      buildBroadcastHtml(
        applyMergeTags(body, rcpt),
        course,
        buildUnsubscribePageUrl(rcpt.email),
        // 測試信也用同一種 messageType：頁尾文案所見即所寄
        notice.messageType,
      ),
    );
    return r.failed > 0
      ? { error: `測試信寄送失敗：${r.error ?? "未知錯誤"}` }
      : { success: `測試信已寄到 ${admin.email}，請收信確認版面` };
  }

  // ── 解析發送對象 ──
  const resolved = await resolveBroadcastAudience(
    audience,
    groupIds,
    sessionIds,
    manualRaw,
    false,
    followUp,
  );
  if (resolved.error) return { error: resolved.error };
  const { audienceData } = resolved;
  const audienceLabel = audienceData.audienceLabel;
  const manualRows = audienceData.manualRows;
  const codeError = await validateCodeCoverage(body, audience, sessionIds, notice.messageType);
  if (codeError) return { error: codeError };

  // 排程模式：datetime-local 值無時區，固定以台灣時間解讀
  if (scheduledAtRaw) {
    const scheduledAt = new Date(`${scheduledAtRaw}:00+08:00`);
    if (isNaN(scheduledAt.getTime())) return { error: "發送時間格式不正確" };
    if (scheduledAt.getTime() < Date.now() + 60_000) {
      return { error: "發送時間需晚於現在（要立即寄出請清空發送時間）" };
    }
    const record = await prisma.emailBroadcast.create({
      data: {
        subject,
        body,
        courseId: courseId || null,
        status: "SCHEDULED",
        scheduledAt,
        sentBy: admin?.email ?? null,
        ...audienceData,
        ...noticeFields,
      },
    });
    revalidatePath("/admin/broadcast");
    const shown = scheduledAt.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
    return {
      success: `已排程：${shown} 寄給「${audienceLabel}」（實際寄出最多晚 5 分鐘；${
        audience === "followup"
          ? "跟進名單以寄出當下的開信/點擊狀態為準，越晚寄涵蓋越完整"
          : "全部會員/群組/場次名單以寄出當下為準"
      }）`,
      broadcastId: record.id,
      manualCount: manualRows?.length,
    };
  }

  // 立即群發：先建紀錄再寄，結果回寫同一筆
  // claimedAt 必填：cron 會把「SENDING 且 claimedAt=null」視為卡死回收標 FAILED，
  // 沒寫的話進行中的立即寄送可能被 cron 誤標
  const record = await prisma.emailBroadcast.create({
    data: {
      subject,
      body,
      courseId: courseId || null,
      status: "SENDING",
      claimedAt: new Date(),
      sentBy: admin?.email ?? null,
      ...audienceData,
      ...noticeFields,
    },
  });
  const r = await executeBroadcast(record.id);

  revalidatePath("/admin/broadcast");
  if (r.sent === 0) return { error: `群發失敗：${r.error ?? "未知錯誤"}` };
  if (r.failed > 0) {
    return {
      error: `寄送完成但有失敗：成功 ${r.sent}、失敗 ${r.failed}（${r.error ?? ""}）`,
      broadcastId: record.id,
      manualCount: manualRows?.length,
    };
  }
  return {
    success: `群發完成！已寄給 ${r.sent} 位收件人（${audienceLabel}）`,
    broadcastId: record.id,
    manualCount: manualRows?.length,
  };
}

/** 取消排程中的群發（只動 SCHEDULED 狀態，已寄出/處理中不受影響） */
export async function cancelScheduledBroadcast(id: string) {
  await requireEditor();
  await prisma.emailBroadcast.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELED" },
  });
  revalidatePath("/admin/broadcast");
}

/** 刪除草稿（只動 DRAFT 狀態） */
export async function deleteDraftBroadcastAction(id: string) {
  await requireEditor();
  await prisma.emailBroadcast.deleteMany({
    where: { id, status: "DRAFT" },
  });
  revalidatePath("/admin/broadcast");
}

/** 編輯排程/草稿後送出（/admin/broadcast/[id]/edit）：
 *  mode=test 寄測試信；mode=draft 存回草稿；mode=all 轉排程或立即寄出。
 *  一律以 updateMany where status in [SCHEDULED, DRAFT] 守衛——
 *  count=0 代表狀態已變（可能已被 cron 認領寄出），不覆寫 */
export async function updateBroadcastAction(
  id: string,
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  await requireEditor();
  const admin = await getAuthUser();

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "");
  const mode = String(formData.get("mode") ?? "test");
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const audience = String(formData.get("audience") ?? "all");
  const groupIds = formData.getAll("groupIds").map(String).filter(Boolean);
  // 場次可複選（同上）；名單於寄出當下才解析，與簡訊模組共用同一份場次報名名單
  const sessionIds = formData.getAll("sessionIds").map(String).filter(Boolean);
  // 履約通知（課前通知）：只擋退信／檢舉，不被行銷退訂擋掉。比照簡訊需勾確認
  const wantsNotice = formData.get("isNotice") === "on";
  const noticeAck = formData.get("noticeAck") === "on";
  const manualRaw = String(
    formData.get(audience === "members" ? "memberList" : "manualList") ?? "",
  );
  const followUp =
    audience === "followup"
      ? {
          sourceBroadcastId: String(formData.get("sourceBroadcastId") ?? ""),
          filter: String(formData.get("followUpFilter") ?? ""),
        }
      : undefined;

  if (!subject) return { error: "請填寫主旨" };
  if (mode !== "draft" && !body) return { error: "請填寫內文" };

  // 履約通知 vs 行銷推播：決定寄出時退訂名單怎麼擋（dispatch.ts filterUnsubscribed）。
  // 草稿不擋（存了再回來補勾），但存進去的一律是已驗證過的值，不會有「草稿是 NOTICE、
  // 送出時才發現對象不合法」的落差。
  const notice = resolveMessageType(audience, wantsNotice, noticeAck);
  if (mode !== "draft" && notice.error) return { error: notice.error };
  const noticeFields = {
    messageType: notice.messageType,
    noticeAckBy:
      notice.messageType === "NOTICE" ? (admin?.email ?? null) : null,
  };
  if (mode !== "draft" && mode !== "template") {
    const preflight = inspectBroadcastDraft({ subject, body });
    if (preflight.errors.length > 0) return { error: preflight.errors.join("；") };
  }

  // 存成範本：只存內容，不動這筆草稿/排程紀錄
  if (mode === "template") {
    return saveMailTemplateFromForm(formData, admin?.email ?? null);
  }

  const course = courseId
    ? await prisma.course.findUnique({
        where: { id: courseId },
        select: { title: true, slug: true, coverImage: true, price: true, listPrice: true },
      })
    : null;

  // 測試信：不動紀錄
  if (mode === "test") {
    if (!admin?.email) return { error: "讀不到你的 email，無法寄測試信" };
    // {code} 帶入真正的上課碼：測試信是版面確認的唯一管道，
    // 這裡留白會讓人以為功能壞了。多選場次時取第一場（示意用途）
    const testCode =
      audience === "session" && sessionIds.length > 0
        ? ((
            await prisma.courseSession.findUnique({
              where: { id: sessionIds[0] },
              select: { accessCode: true },
            })
          )?.accessCode ?? undefined)
        : undefined;
    const me = {
      email: admin.email,
      name: admin.displayName ?? undefined,
      code: testCode,
    };
    const r = await sendBroadcast([me], `[測試] ${subject}`, (rcpt) =>
      buildBroadcastHtml(
        applyMergeTags(body, rcpt),
        course,
        buildUnsubscribePageUrl(rcpt.email),
        // 測試信也用同一種 messageType：頁尾文案所見即所寄
        notice.messageType,
      ),
    );
    return r.failed > 0
      ? { error: `測試信寄送失敗：${r.error ?? "未知錯誤"}` }
      : { success: `測試信已寄到 ${admin.email}，請收信確認版面` };
  }

  const editableWhere = { id, status: { in: ["SCHEDULED", "DRAFT"] } };
  const staleMsg = "這筆紀錄的狀態已變更（可能已寄出或被取消），請回寄送紀錄確認";

  // 存回草稿
  if (mode === "draft") {
    const { audienceData } = await resolveBroadcastAudience(
      audience,
      groupIds,
      sessionIds,
      manualRaw,
      true,
      followUp,
    );
    const scheduledAt = scheduledAtRaw
      ? new Date(`${scheduledAtRaw}:00+08:00`)
      : null;
    const updated = await prisma.emailBroadcast.updateMany({
      where: editableWhere,
      data: {
        subject,
        body,
        courseId: courseId || null,
        status: "DRAFT",
        scheduledAt: scheduledAt && !isNaN(scheduledAt.getTime()) ? scheduledAt : null,
        sentBy: admin?.email ?? null,
        ...audienceData,
        ...noticeFields,
      },
    });
    if (updated.count === 0) return { error: staleMsg };
    revalidatePath("/admin/broadcast");
    return { success: "草稿已更新", broadcastId: id };
  }

  // 正式：解析發送對象（嚴格）
  const resolved = await resolveBroadcastAudience(
    audience,
    groupIds,
    sessionIds,
    manualRaw,
    false,
    followUp,
  );
  if (resolved.error) return { error: resolved.error };
  const { audienceData } = resolved;
  const codeError = await validateCodeCoverage(body, audience, sessionIds, notice.messageType);
  if (codeError) return { error: codeError };

  // 轉排程
  if (scheduledAtRaw) {
    const scheduledAt = new Date(`${scheduledAtRaw}:00+08:00`);
    if (isNaN(scheduledAt.getTime())) return { error: "發送時間格式不正確" };
    if (scheduledAt.getTime() < Date.now() + 60_000) {
      return { error: "發送時間需晚於現在（要立即寄出請清空發送時間）" };
    }
    const updated = await prisma.emailBroadcast.updateMany({
      where: editableWhere,
      data: {
        subject,
        body,
        courseId: courseId || null,
        status: "SCHEDULED",
        scheduledAt,
        sentBy: admin?.email ?? null,
        ...audienceData,
        ...noticeFields,
      },
    });
    if (updated.count === 0) return { error: staleMsg };
    revalidatePath("/admin/broadcast");
    const shown = scheduledAt.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
    return {
      success: `已更新排程：${shown} 寄給「${audienceData.audienceLabel}」`,
      broadcastId: id,
    };
  }

  // 立即寄出：原子認領（防與 cron 撞）後執行
  const claimed = await prisma.emailBroadcast.updateMany({
    where: editableWhere,
    data: {
      subject,
      body,
      courseId: courseId || null,
      status: "SENDING",
      claimedAt: new Date(),
      scheduledAt: null,
      sentBy: admin?.email ?? null,
      ...audienceData,
      ...noticeFields,
    },
  });
  if (claimed.count === 0) return { error: staleMsg };
  const r = await executeBroadcast(id);

  revalidatePath("/admin/broadcast");
  if (r.sent === 0) return { error: `群發失敗：${r.error ?? "未知錯誤"}` };
  if (r.failed > 0) {
    return {
      error: `寄送完成但有失敗：成功 ${r.sent}、失敗 ${r.failed}（${r.error ?? ""}）`,
      broadcastId: id,
    };
  }
  return {
    success: `群發完成！已寄給 ${r.sent} 位收件人（${audienceData.audienceLabel}）`,
    broadcastId: id,
  };
}

/** 補寄失敗者：只對原紀錄 failedRecipients 名單重寄。
 *  開「新」EmailBroadcast 紀錄（MANUAL + resendOfId）保留稽核軌跡；
 *  補寄後把原紀錄 failedRecipients 更新為「仍失敗子集」（全成功設 null），
 *  sentCount/failedCount 凍結不動 → 按鈕數字隨補寄收斂、重複點擊冪等 */
export async function resendFailedBroadcastAction(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  await requireEditor();
  const admin = await getAuthUser();

  const id = String(formData.get("broadcastId") ?? "");
  const orig = await prisma.emailBroadcast.findUnique({ where: { id } });
  if (!orig) return { error: "找不到群發紀錄" };
  if (orig.status !== "SENT" && orig.status !== "FAILED") {
    return { error: "只有已寄出/失敗的群發可以補寄" };
  }
  const failed = (orig.failedRecipients ?? []) as FailedRecipient[];
  if (!Array.isArray(failed) || failed.length === 0) {
    return { error: "這筆群發沒有失敗名單可補寄" };
  }

  // 併發防護：同一筆已有補寄進行中就擋下（避免連點重複寄）
  const inFlight = await prisma.emailBroadcast.findFirst({
    where: { resendOfId: id, status: "SENDING" },
    select: { id: true },
  });
  if (inFlight) return { error: "已有補寄進行中，請稍候再試" };

  const record = await prisma.emailBroadcast.create({
    data: {
      subject: orig.subject,
      body: orig.body,
      courseId: orig.courseId,
      status: "SENDING",
      claimedAt: new Date(),
      sentBy: admin?.email ?? null,
      audienceType: "MANUAL",
      // 補寄一封課前通知仍然是課前通知：不繼承的話會退化成 MARKETING，
      // 原本收得到的人反而被行銷退訂擋掉——補寄補了個寂寞
      messageType: orig.messageType,
      noticeAckBy: orig.noticeAckBy,
      audienceLabel: `補寄失敗者 ${failed.length} 筆（來源：${orig.subject}）`,
      manualRows: failed.map((f) =>
        f.name ? { email: f.email, name: f.name } : { email: f.email },
      ),
      resendOfId: orig.id,
    },
  });
  const r = await executeBroadcast(record.id);

  // 原紀錄失敗名單收斂為仍失敗子集
  await prisma.emailBroadcast.update({
    where: { id: orig.id },
    data: {
      failedRecipients:
        r.failedRecipients.length > 0 ? r.failedRecipients : Prisma.JsonNull,
    },
  });

  revalidatePath("/admin/broadcast");
  revalidatePath(`/admin/broadcast/${id}`);
  if (r.failed > 0) {
    return {
      error: `補寄完成但仍有失敗：成功 ${r.sent}、失敗 ${r.failed}（${r.error ?? ""}）`,
      broadcastId: record.id,
    };
  }
  return {
    success: `補寄完成！已成功寄給 ${r.sent} 位原本失敗的收件人`,
    broadcastId: record.id,
  };
}

// ───────────────────────── 電子報名單群組 ─────────────────────────

/** 把名單列（email+姓名）塞進群組，群組內 email 重複自動略過。回傳實際新增筆數 */
async function addRowsToGroup(
  groupId: string,
  rows: { email: string; name?: string }[],
): Promise<number> {
  const seen = new Set<string>();
  const data = rows
    .map((r) => ({ email: r.email.trim().toLowerCase(), name: r.name?.trim() || null }))
    .filter((r) => EMAIL_RE.test(r.email))
    .filter((r) => !seen.has(r.email) && seen.add(r.email))
    .map((r) => ({ ...r, groupId }));
  if (data.length === 0) return 0;
  const created = await prisma.mailGroupMember.createMany({
    data,
    skipDuplicates: true,
  });
  return created.count;
}

/** 解析表單指定的目標寄信群組：有 groupName 就新建或併入既有，否則用既有 groupId；都沒有回 null */
async function resolveTargetGroup(
  formData: FormData,
): Promise<{ id: string; name: string } | null> {
  const groupName = String(formData.get("groupName") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "").trim();
  if (groupName) {
    const g = await prisma.mailGroup.upsert({
      where: { name: groupName },
      update: {},
      create: { name: groupName },
    });
    return { id: g.id, name: g.name };
  }
  if (groupId) {
    return prisma.mailGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true },
    });
  }
  return null;
}

/** 取出表單中的名單內容：貼上的文字 + 上傳的 CSV（UTF-8/Big5 自動判斷） */
async function readListInput(formData: FormData): Promise<{ text: string; error?: string }> {
  const raw = String(formData.get("list") ?? "");
  const csv = formData.get("csv");
  let csvText = "";
  if (csv instanceof File && csv.size > 0) {
    if (csv.size > 2 * 1024 * 1024) return { text: "", error: "CSV 檔案請小於 2MB" };
    csvText = decodeCsvBuffer(await csv.arrayBuffer());
  }
  return { text: [raw, csvText].filter((s) => s.trim()).join("\n") };
}

/** 建立名單群組（可貼名單或上傳 CSV）。名稱重複改為加入既有群組 */
export async function createMailGroupAction(formData: FormData) {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { text } = await readListInput(formData);

  const group = await prisma.mailGroup.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  if (text.trim()) await addRowsToGroup(group.id, parseRows(text));
  revalidatePath("/admin/broadcast/groups");
  redirect(`/admin/broadcast/groups/${group.id}`);
}

export async function renameMailGroup(id: string, formData: FormData) {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // 撞名就略過（名稱唯一）
  await prisma.mailGroup.update({ where: { id }, data: { name } }).catch(() => undefined);
  revalidatePath("/admin/broadcast/groups");
  revalidatePath(`/admin/broadcast/groups/${id}`);
}

/** 刪除群組（成員一併刪除；不影響歷史寄送紀錄） */
export async function deleteMailGroup(id: string) {
  await requireEditor();
  await prisma.mailGroup.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/broadcast/groups");
  redirect("/admin/broadcast/groups");
}

export type GroupAddState = { error?: string; success?: string } | null;

/** 貼名單或上傳 CSV 加入群組成員（email 重複自動略過），回報結果筆數 */
export async function addGroupMembersAction(
  groupId: string,
  _prev: GroupAddState,
  formData: FormData,
): Promise<GroupAddState> {
  await requireEditor();

  const { text, error } = await readListInput(formData);
  if (error) return { error };
  if (!text.trim()) return { error: "請貼上名單或選擇 CSV 檔案" };

  const rows = parseRows(text);
  const valid = rows.filter((r) => EMAIL_RE.test(r.email));
  if (valid.length === 0)
    return { error: "沒有讀到任何合法 email，請確認內容或 CSV 格式（參考範本）" };

  const added = await addRowsToGroup(groupId, valid);
  revalidatePath(`/admin/broadcast/groups/${groupId}`);
  revalidatePath("/admin/broadcast/groups");

  const skippedDup = valid.length - added;
  const skippedBad = rows.length - valid.length;
  return {
    success: `已加入 ${added} 筆${skippedDup > 0 ? `、${skippedDup} 筆已在群組內略過` : ""}${skippedBad > 0 ? `、${skippedBad} 行無法辨識已忽略` : ""}`,
  };
}

export async function removeGroupMember(memberId: string, groupId: string) {
  await requireEditor();
  await prisma.mailGroupMember.deleteMany({ where: { id: memberId } });
  revalidatePath(`/admin/broadcast/groups/${groupId}`);
  revalidatePath("/admin/broadcast/groups");
}

export type GroupMemberEditState = { error?: string; success?: string } | null;

/** 原地修改群組成員的 email / 姓名（修正匯入時打錯的資料） */
export async function updateGroupMemberAction(
  memberId: string,
  groupId: string,
  _prev: GroupMemberEditState,
  formData: FormData,
): Promise<GroupMemberEditState> {
  await requireEditor();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確" };

  const dup = await prisma.mailGroupMember.findFirst({
    where: { groupId, email, NOT: { id: memberId } },
    select: { id: true },
  });
  if (dup) return { error: `${email} 已在群組內，請改用移除` };

  await prisma.mailGroupMember.update({
    where: { id: memberId },
    data: { email, name: name || null },
  });
  revalidatePath(`/admin/broadcast/groups/${groupId}`);
  return { success: "已更新" };
}

/** 把某次群發的名單存進群組：
 *  newName 有填 → 建立（或併入同名）群組；否則加入選擇的既有群組。
 *  名單來源優先用 manualRows（含姓名），否則用寄出快照 recipients */
export async function saveBroadcastListToGroupAction(
  broadcastId: string,
  formData: FormData,
) {
  await requireEditor();
  const newName = String(formData.get("newName") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "");

  const record = await prisma.emailBroadcast.findUnique({
    where: { id: broadcastId },
    select: { manualRows: true, recipients: true },
  });
  if (!record) return;

  const rows: { email: string; name?: string }[] =
    Array.isArray(record.manualRows) && record.manualRows.length > 0
      ? (record.manualRows as { email: string; name?: string }[])
      : record.recipients.map((email) => ({ email }));
  if (rows.length === 0) return;

  let targetId = groupId;
  if (newName) {
    const group = await prisma.mailGroup.upsert({
      where: { name: newName },
      update: {},
      create: { name: newName },
    });
    targetId = group.id;
  }
  if (!targetId) return;

  await addRowsToGroup(targetId, rows);
  revalidatePath("/admin/broadcast/groups");
  redirect(`/admin/broadcast/groups/${targetId}`);
}

/** 把某堂課目前的觀看權限名單整批匯出成名單群組（建新或併入既有），完成後跳到群組頁 */
export async function createGroupFromCourseAction(
  courseId: string,
  formData: FormData,
) {
  await requireEditor();
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { title: true },
  });
  if (!course) return;

  const newName =
    String(formData.get("newName") ?? "").trim() ||
    `${course.title} 觀看名單`;
  const groupId = String(formData.get("groupId") ?? "");

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId },
    select: { userId: true },
  });
  if (enrollments.length === 0) return;

  // userId → email/姓名（listProfiles 已分頁，破千也撈得全）
  const profiles = await listProfiles();
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const rows = enrollments
    .map((e) => byId.get(e.userId))
    .filter((p): p is NonNullable<typeof p> => !!p && !!p.email)
    .map((p) => ({ email: p.email as string, name: p.display_name ?? undefined }))
    .filter((r) => !seen.has(r.email) && seen.add(r.email));
  if (rows.length === 0) return;

  let targetId = groupId;
  if (newName && !groupId) {
    const group = await prisma.mailGroup.upsert({
      where: { name: newName },
      update: {},
      create: { name: newName },
    });
    targetId = group.id;
  }
  if (!targetId) return;

  await addRowsToGroup(targetId, rows);
  revalidatePath("/admin/broadcast/groups");
  redirect(`/admin/broadcast/groups/${targetId}`);
}

// ───────────────────────── 課程分類 ─────────────────────────

export async function addCategory(formData: FormData) {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // 名稱唯一，重複就略過（不炸頁）
  await prisma.category
    .create({ data: { name } })
    .catch(() => undefined);
  revalidatePath("/admin/categories");
}

export async function updateCategory(id: string, formData: FormData) {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.category
    .update({ where: { id }, data: { name } })
    .catch(() => undefined);
  revalidatePath("/admin/categories");
}

export async function deleteCategory(id: string) {
  await requireEditor();
  // 多對多關聯只會解除課程的分類標記，不會動到課程本身
  await prisma.category.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/admin/categories");
}

// ───────────────────────── 批次功能 ─────────────────────────

// 要求 TLD 至少 2 個字母，防止 user@localhost. 或單字元 TLD 通過
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const MAX_BATCH_ROWS = 500;

export type BatchRowResult = {
  email: string;
  name?: string; // 名單解析出的姓名（查無會員轉批次新增時帶入）
  status:
    | "created" // 匯入成功
    | "exists" // 會員已存在
    | "enrolled" // 開通成功
    | "already" // 本來就有權限
    | "pending" // 尚未註冊，已建立待開通
    | "notfound" // 舊流程相容：查無會員
    | "conflict" // 同一 email 對應不同姓名，需人工確認
    | "invalid" // 格式錯誤
    | "error"; // 其他錯誤
  detail?: string;
};

export type BatchState = {
  done: boolean;
  summary?: string;
  results?: BatchRowResult[];
  error?: string;
  courseId?: string; // 批次開通的課程（查無會員轉批次新增時帶入）
  courseTitle?: string;
} | null;

// 把貼上的名單拆成列（逗號/全形逗號/Tab 分隔），欄位順序不限，自動辨識：
// - 符合 email 格式的欄位 → email
// - 含中文的欄位 → 姓名
// - 其餘欄位 → 密碼（單一非中文欄位時：≥6 碼且含數字當密碼，否則當英文姓名）
// 空行與 # 開頭的註解行略過
// 容錯（實際貼名單常見狀況）：
// - 零寬字元移除、不斷行空白轉一般空白（LINE / 網頁複製會夾帶）
// - 以「.」開頭的行自動接回上一行（email 被折行成兩行時還原）
// - 欄位裡同時有 @ 和空白 → 再按空白拆欄（空白分隔的貼法）
// - 一行出現多個 email（整批空白分隔貼上）→ 每個 email 各自成一筆
function parseRows(raw: string): { email: string; name: string; password: string }[] {
  const CJK = /[一-鿿]/;

  const lines: string[] = [];
  for (const rawLine of raw
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith(".") && lines.length > 0)
      lines[lines.length - 1] += line;
    else lines.push(line);
  }

  return lines.flatMap((line) => {
    const parts = line
      .split(/[,\t，]/)
      .flatMap((p) => {
        if (!(/@/.test(p) && /\s/.test(p.trim()))) return [p];
        // 欄位裡有 @ 又夾空白 → 按空白拆欄；「.」開頭的片段接回前一段
        // （email 內夾到隱形空白或折行時還原）
        const tokens: string[] = [];
        for (const t of p.trim().split(/\s+/)) {
          if (t.startsWith(".") && tokens.length > 0)
            tokens[tokens.length - 1] += t;
          else tokens.push(t);
        }
        return tokens;
      })
      .map((s) => s.trim())
      .filter(Boolean);

    const emails = parts.filter((p) => EMAIL_RE.test(p));
    const rest = parts.filter((p) => !EMAIL_RE.test(p));

    if (emails.length > 1)
      return emails.map((e) => ({
        email: e.toLowerCase(),
        name: "",
        password: "",
      }));

    const email = (emails[0] ?? "").toLowerCase();
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
    return [{ email, name, password }];
  });
}

/** 記錄管理員設定的初始密碼（後台備查；學員自行改密碼不會同步） */
async function recordMemberPassword(userId: string, password: string, by: string | null) {
  await prisma.memberPassword
    .upsert({
      where: { userId },
      update: { password, updatedBy: by },
      create: { userId, password, updatedBy: by },
    })
    .catch(() => undefined); // 備查紀錄失敗不影響主流程
}

/** 單筆手動新增會員 */
export async function addMemberAction(
  _prev: EnrollmentEditState,
  formData: FormData,
): Promise<EnrollmentEditState> {
  await requireEditor();

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
  const admin = await getAuthUser();
  await recordMemberPassword(created.userId, password, admin?.email ?? null);
  // 帳號出現 → 認領各課程的待開通存底（失敗不影響建立結果）
  const claimed = await claimPendingEnrollments(email, created.userId).catch(() => 0);

  revalidatePath("/admin/members");
  return {
    success: `已建立會員 ${name}（${email}）${claimed > 0 ? `，並自動開通 ${claimed} 門待開通課程` : ""}`,
  };
}

/** 會員批次匯入：建立 Supabase Auth 帳號（profiles 由 QBC trigger 自動建立） */
export async function importMembersAction(
  _prev: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await requireEditor();
  const adminUser = await getAuthUser();

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
      // 注意：此處只確認 public.profiles 存在，未交叉驗證 auth.users。
      // 若 auth 帳號已被刪除但 profiles 殘留，跳過可能導致 Enrollment 孤兒資料。
      // 發生機率極低（需管理員手動刪除 Supabase 使用者），可接受現狀。
      results.push({
        email: row.email,
        status: "exists",
        detail: "已完成註冊，自動跳過（帳號與密碼未變動）",
      });
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
      await recordMemberPassword(created.userId, password, adminUser?.email ?? null);
      // 帳號出現 → 認領各課程的待開通存底
      const claimed = await claimPendingEnrollments(row.email, created.userId).catch(() => 0);
      results.push({
        email: row.email,
        status: "created",
        detail: claimed > 0 ? `已自動開通 ${claimed} 門待開通課程` : undefined,
      });
    } else if (created.reason === "exists") {
      results.push({
        email: row.email,
        status: "exists",
        detail: "已完成註冊，自動跳過（帳號與密碼未變動）",
      });
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
  await requireEditor();

  const courseId = String(formData.get("courseId") ?? "");
  const raw = String(formData.get("list") ?? "");
  const rows = parseRows(raw);
  // 選填：有填預設密碼 → 查無會員這次就直接建帳號＋開通（一次送出）；留空 → 走二段式
  const defaultPassword = String(formData.get("defaultPassword") ?? "").trim();

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { done: true, error: "請選擇課程" };
  if (rows.length === 0) return { done: true, error: "名單是空的，請先貼上資料" };
  if (defaultPassword && defaultPassword.length < 6)
    return { done: true, error: "預設密碼至少 6 字元（不需要建帳號可留空）" };
  if (rows.length > MAX_BATCH_ROWS)
    return { done: true, error: `一次最多 ${MAX_BATCH_ROWS} 筆（目前 ${rows.length} 筆），請分批開通` };

  // 管理員身分：記錄初始密碼備查＋待開通存底的 createdBy
  const admin = await getAuthUser();

  const results: BatchRowResult[] = [];
  const seen = new Set<string>();
  const succeeded: { email: string; userId: string }[] = []; // 收殘留待開通的認領標記用

  // 同一 Email 對應不同姓名，多半是同行者共用訂購人信箱；不能猜要把影片開給誰。
  const conflictEmails = findIdentityConflictEmails(rows.filter((row) => EMAIL_RE.test(row.email)));

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
    if (conflictEmails.has(row.email)) {
      results.push({
        email: row.email,
        name: row.name || undefined,
        status: "conflict",
        detail: "同一 Email 對應不同姓名，未開通也未建立待開通，請人工確認正確登入帳號",
      });
      continue;
    }

    let userId = profileMap.get(row.email)?.id;

    // B7：profiles 查不到時，可能只是 profiles 同步延遲、帳號其實已存在。
    // 「只反查、不建立」既有 auth user id（不呼叫 createMember，避免把真的不存在的
    // email 建成隨機密碼帳號）；反查到就開通杜絕漏開，反查不到才視為查無會員。
    if (!userId) {
      userId = (await findAuthUserIdByEmail(row.email)) ?? undefined;
    }

    if (!userId) {
      // 查無會員 → 先存底待開通：學員之後註冊（或管理員建帳號）當下自動認領開通。
      // 存底失敗不阻斷（結果列仍照實回報）。
      await recordPendingEnrollment(courseId, row, admin?.email ?? null).catch((e) =>
        console.error("[batchEnroll] 待開通存底失敗", { email: row.email, e }),
      );
      // 留空密碼：標查無（已存底），也可用下方二段式面板立即建帳號
      if (!defaultPassword) {
        results.push({
          email: row.email,
          name: row.name || undefined,
          status: "pending",
          detail: "尚未註冊，已建立待開通；學員使用同一 Email 註冊後自動開通",
        });
        continue;
      }
      // 有填密碼：直接建立帳號 → 記錄初始密碼 → 開通（source IMPORT）
      const usedPassword = row.password || defaultPassword;
      const created = await createMember({
        email: row.email,
        password: usedPassword,
        displayName: row.name || row.email.split("@")[0],
      });
      if (created.ok) {
        await recordMemberPassword(created.userId, usedPassword, admin?.email ?? null);
        // 帳號出現 → 認領全部待開通（含本課程剛存底那筆與其他課程的）
        await claimPendingEnrollments(row.email, created.userId).catch(() => 0);
        try {
          await prisma.enrollment.upsert({
            where: { userId_courseId: { userId: created.userId, courseId } },
            update: {},
            create: { userId: created.userId, courseId, source: "IMPORT" },
          });
          results.push({ email: row.email, status: "created", detail: "已建立會員並開通權限" });
        } catch (e) {
          results.push({
            email: row.email,
            status: "error",
            detail: e instanceof Error ? e.message : "未知錯誤",
          });
        }
        continue;
      }
      // 帳號其實已存在（profiles 同步延遲）：反查到 userId 就往下開通
      if (created.reason === "exists" && created.userId) {
        userId = created.userId;
      } else {
        results.push({
          email: row.email,
          status: "error",
          detail:
            created.reason === "exists"
              ? "帳號已存在但會員資料尚未同步，請稍後重試"
              : created.message,
        });
        continue;
      }
    }
    if (enrolled.has(userId)) {
      results.push({ email: row.email, status: "already", detail: "本來就有觀看權限" });
      succeeded.push({ email: row.email, userId });
      continue;
    }

    try {
      // upsert + @@unique(userId, courseId) 雙重保險，重跑不會出錯
      await prisma.enrollment.upsert({
        where: { userId_courseId: { userId, courseId } },
        update: {},
        create: { userId, courseId, source: "BATCH" },
      });
      results.push({ email: row.email, status: "enrolled" });
      succeeded.push({ email: row.email, userId });
    } catch (e) {
      results.push({
        email: row.email,
        status: "error",
        detail: e instanceof Error ? e.message : "未知錯誤",
      });
    }
  }

  // 開通成功者若有先前的待開通存底（例：機制上線前貼過名單、學員後來註冊），標記已認領
  await markPendingClaimed(courseId, succeeded).catch(() => undefined);

  // 選配：把整份名單一併加入寄信名單群組（新建或既有）
  const group = await resolveTargetGroup(formData);
  let groupMsg = "";
  if (group) {
    const added = await addRowsToGroup(group.id, rows);
    groupMsg = `；已加入名單群組「${group.name}」新增 ${added} 筆`;
    revalidatePath("/admin/broadcast/groups");
    revalidatePath(`/admin/broadcast/groups/${group.id}`);
  }
  if (defaultPassword) revalidatePath("/admin/members");

  const c = (s: BatchRowResult["status"]) => results.filter((r) => r.status === s).length;
  return {
    done: true,
    summary: `「${course.title}」處理完成：新增帳號並開通 ${c("created")}、直接開通 ${c("enrolled")}、已有權限 ${c("already")}、待註冊 ${c("pending")}、身分衝突 ${c("conflict")}、格式錯誤 ${c("invalid")}、失敗 ${c("error")}${groupMsg}`,
    results,
    courseId,
    courseTitle: course.title,
  };
}

/** 查無會員轉一鍵處理：缺帳號的先建立（用預設密碼），已存在的直接開通，全部接著開通課程權限 */
export async function createMissingAndEnrollAction(
  _prev: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await requireEditor();
  const admin = await getAuthUser();

  const courseId = String(formData.get("courseId") ?? "");
  const raw = String(formData.get("list") ?? "");
  const defaultPassword = String(formData.get("defaultPassword") ?? "").trim();
  const rows = parseRows(raw);

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { done: true, error: "找不到課程，請重新執行批次開通" };
  if (rows.length === 0) return { done: true, error: "名單是空的" };
  if (defaultPassword.length < 6)
    return { done: true, error: "預設密碼至少 6 字元" };
  if (rows.length > MAX_BATCH_ROWS)
    return { done: true, error: `一次最多 ${MAX_BATCH_ROWS} 筆，請分批` };

  const results: BatchRowResult[] = [];
  const seen = new Set<string>();
  const succeeded: { email: string; userId: string }[] = []; // 收殘留待開通的認領標記用
  const validEmails = [...new Set(rows.map((r) => r.email).filter((e) => EMAIL_RE.test(e)))];
  // 重新查一次會員（避免上一步之後名單已有變化），已註冊的不會動到帳號
  const profileMap = await getProfilesByEmails(validEmails);

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

    let userId = profileMap.get(row.email)?.id;
    let createdNew = false;

    if (!userId) {
      const usedPassword = row.password || defaultPassword;
      const created = await createMember({
        email: row.email,
        password: usedPassword,
        displayName: row.name || row.email.split("@")[0],
      });
      if (created.ok) {
        userId = created.userId;
        createdNew = true;
        await recordMemberPassword(created.userId, usedPassword, admin?.email ?? null);
        // 帳號出現 → 認領全部課程的待開通存底
        await claimPendingEnrollments(row.email, created.userId).catch(() => 0);
      } else if (created.reason === "exists" && created.userId) {
        // B7：profiles 尚未同步但帳號其實已存在，反查到 auth user id 就直接開通。
        // Enrollment.userId = auth.users.id，本就不依賴 profiles，徹底解決漏開。
        userId = created.userId;
      } else {
        results.push({
          email: row.email,
          status: "error",
          detail:
            created.reason === "exists"
              ? "帳號已存在但會員資料尚未同步，請稍後用批次開通重試"
              : created.message,
        });
        continue;
      }
    }

    try {
      await prisma.enrollment.upsert({
        where: { userId_courseId: { userId, courseId } },
        update: {},
        create: { userId, courseId, source: createdNew ? "IMPORT" : "BATCH" },
      });
      succeeded.push({ email: row.email, userId });
      results.push({
        email: row.email,
        status: createdNew ? "created" : "enrolled",
        detail: createdNew ? "已建立會員並開通權限" : "會員已存在，直接開通權限",
      });
    } catch (e) {
      results.push({
        email: row.email,
        status: "error",
        detail: e instanceof Error ? e.message : "未知錯誤",
      });
    }
  }

  // 開通成功者的殘留待開通存底標記已認領（例：批次開通那一步剛存底、這裡隨即建帳號開通）
  await markPendingClaimed(courseId, succeeded).catch(() => undefined);

  const c = (s: BatchRowResult["status"]) => results.filter((r) => r.status === s).length;
  revalidatePath("/admin/members");
  return {
    done: true,
    summary: `「${course.title}」處理完成：新增會員並開通 ${c("created")}、僅開通 ${c("enrolled")}、格式錯誤 ${c("invalid")}、失敗 ${c("error")}`,
    results,
  };
}

// ── 分頁管理（前台導覽分頁開關）── 僅管理員

export async function togglePageAction(key: SitePageKey, enabled: boolean) {
  await requireFullAdmin();
  await setPageEnabled(key, enabled);
  // navbar 在 root layout，全站重新驗證
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
}

/** 儲存全站追蹤碼設定（GA4/Meta Pixel/GTM）。
 *  格式嚴格驗證：ID 會內插進前台 inline script，不能放行任意字串；空字串 = 停用 */
// ─────────────────── 1shop 訂單回填會員手機 ───────────────────

export type PhoneImportReport = {
  totalRows: number; // 檔案資料列數
  withContact: number; // 有 email＋可辨識手機的唯一 email 數
  invalidPhone: number; // 有 email 但手機無法辨識的列數
  matchedMembers: number; // email 對到平台會員
  notMemberCount: number; // 對不到會員（未註冊或用別的信箱）
  notMemberSample: string[]; // 對不到的 email 前 20 筆
  filled: number; // 實際回填/更新的手機筆數
  alreadyConsented: number; // 已自行補齊（有同意紀錄）→ 不動
  alreadyHadPhone: number; // 先前回填過同號碼 → 略過
  conflicts: { email: string; name: string; memberPhone: string; orderPhone: string }[]; // 會員自填 ≠ 訂單，僅列出不覆蓋
};

export type PhoneImportState =
  | { error?: string; report?: PhoneImportReport }
  | null;

const PHONE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** 上傳 1shop 訂單檔 → 以「顧客信箱」對會員 → 回填「顧客電話」到 MemberProfile。
 *
 *  合規邊界：只寫 phone、絕不寫同意欄位——同意必須由會員本人在補填頁勾選，
 *  回填後會員登入時手機已預填、勾同意即完成。
 *  覆蓋原則：會員自己填過的手機（有同意紀錄）一律不動，不同時列入 conflicts 供查核。 */
export async function importMemberPhonesAction(
  _prev: PhoneImportState,
  formData: FormData,
): Promise<PhoneImportState> {
  await requireEditor();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "請選擇 1shop 匯出的訂單檔（.xlsx 或 .csv）" };
  if (file.size > PHONE_IMPORT_MAX_BYTES)
    return { error: "檔案超過 10MB，請確認是否選錯檔案" };
  if (!/\.(xlsx|csv)$/i.test(file.name))
    return { error: "只接受 .xlsx 或 .csv 檔（1shop 匯出的訂單檔）" };

  let rows;
  try {
    ({ rows } = await parseOrderFile(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "解析失敗，請確認檔案格式" };
  }

  // email → 最新一筆可辨識手機（同 email 多筆訂單以建立日期最新者為準）
  const byEmail = new Map<string, { phone: string; at: number; name: string }>();
  let invalidPhone = 0;
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    // normalizeContactPhone 而非 normalizeMobile：海外會員訂單填的 +60... 也要回填。
    // MemberProfile 存得下 E.164（2026-08-23 起），這裡若還用 normalizeMobile，
    // 海外會員會被算進「無法辨識」丟掉——他們正是最需要預填號碼的一群
    //（自己填得出來，但補填頁一片空白時最容易放棄）。
    const phone = normalizeContactPhone(r.phone);
    if (!phone) {
      if (r.phone.trim()) invalidPhone++;
      continue;
    }
    const at = r.orderedAt?.getTime() ?? 0;
    const cur = byEmail.get(email);
    if (!cur || at >= cur.at) byEmail.set(email, { phone, at, name: r.name });
  }
  if (byEmail.size === 0)
    return { error: "檔案中找不到任何「顧客信箱＋可辨識手機」的資料列" };

  // email → 會員（大小寫不敏感、分批查，getProfilesByEmails 既有工具）
  const profileMap = await getProfilesByEmails([...byEmail.keys()]);

  const report: PhoneImportReport = {
    totalRows: rows.length,
    withContact: byEmail.size,
    invalidPhone,
    matchedMembers: 0,
    notMemberCount: 0,
    notMemberSample: [],
    filled: 0,
    alreadyConsented: 0,
    alreadyHadPhone: 0,
    conflicts: [],
  };

  const matched: { userId: string; email: string; phone: string; name: string }[] = [];
  for (const [email, info] of byEmail) {
    const p = profileMap.get(email);
    if (!p) {
      report.notMemberCount++;
      if (report.notMemberSample.length < 20) report.notMemberSample.push(email);
      continue;
    }
    matched.push({ userId: p.id, email, phone: info.phone, name: info.name });
  }
  report.matchedMembers = matched.length;

  const existingRows = await prisma.memberProfile.findMany({
    where: { userId: { in: matched.map((m) => m.userId) } },
    select: { userId: true, phone: true, privacyConsentAt: true },
  });
  const existingById = new Map(existingRows.map((r) => [r.userId, r]));

  const toCreate: { userId: string; phone: string }[] = [];
  const toUpdate: { userId: string; phone: string }[] = [];
  for (const m of matched) {
    const ex = existingById.get(m.userId);
    if (!ex) {
      toCreate.push({ userId: m.userId, phone: m.phone });
      continue;
    }
    if (ex.privacyConsentAt) {
      // 會員自己完成過補填：本人填的優先，絕不覆蓋；號碼不同列入查核
      report.alreadyConsented++;
      if (ex.phone !== m.phone) {
        report.conflicts.push({
          email: m.email,
          name: m.name,
          memberPhone: ex.phone,
          orderPhone: m.phone,
        });
      }
      continue;
    }
    // 先前回填過（未同意）：訂單有更新的號碼就跟著更新
    if (ex.phone === m.phone) report.alreadyHadPhone++;
    else toUpdate.push({ userId: m.userId, phone: m.phone });
  }

  if (toCreate.length > 0) {
    const res = await prisma.memberProfile.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    report.filled += res.count;
  }
  for (const u of toUpdate) {
    await prisma.memberProfile.update({
      where: { userId: u.userId },
      data: { phone: u.phone },
    });
    report.filled++;
  }

  revalidatePath("/admin/members");
  return { report };
}

export async function saveTrackingSettingsAction(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  await requireFullAdmin();

  const fields = [
    {
      key: TRACKING_KEYS.ga4,
      value: String(formData.get("ga4") ?? "").trim(),
      re: /^G-[A-Z0-9]{4,20}$/i,
      label: "GA4 評估 ID 格式不正確（應為 G- 開頭，例：G-XXXXXXXXXX）",
    },
    {
      key: TRACKING_KEYS.metaPixel,
      value: String(formData.get("metaPixel") ?? "").trim(),
      re: /^\d{5,20}$/,
      label: "Meta Pixel ID 格式不正確（應為純數字）",
    },
    {
      key: TRACKING_KEYS.gtm,
      value: String(formData.get("gtm") ?? "").trim(),
      re: /^GTM-[A-Z0-9]{4,15}$/i,
      label: "GTM 容器 ID 格式不正確（應為 GTM- 開頭，例：GTM-XXXXXXX）",
    },
  ];
  for (const f of fields) {
    if (f.value && !f.re.test(f.value)) return { error: f.label };
  }

  for (const f of fields) {
    await prisma.siteSetting.upsert({
      where: { key: f.key },
      create: { key: f.key, value: f.value },
      update: { value: f.value },
    });
  }
  // 追蹤碼在 root layout 注入，全站重新驗證
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { success: "追蹤碼設定已儲存，前台即刻生效" };
}

// ── 權限管理（指派總教練/操作人員）── 僅管理員

export type StaffAssignState = { error?: string; success?: string } | null;

/** 指派會員為 操作人員/總教練（以 email 找會員）。admin 身分由 QBC 管，不在此指派 */
export async function assignStaffRoleAction(
  _prev: StaffAssignState,
  formData: FormData,
): Promise<StaffAssignState> {
  await requireFullAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const admin = await getAuthUser();

  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確" };
  if (role !== "OPERATOR" && role !== "COACH")
    return { error: "請選擇角色（操作人員 / 總教練）" };

  // 以 email 找會員（須為平台會員）
  const profileMap = await getProfilesByEmails([email]);
  const profile = profileMap.get(email);
  if (!profile) return { error: `查無會員 ${email}，請先確認此人是平台會員` };
  if (isAdminRole(profile.role))
    return { error: "此帳號已是管理員，不需另外指派" };

  // 稽核記錄（Vercel function logs）：記錄角色異動前後值
  const prevRole = await prisma.staffRole.findUnique({ where: { userId: profile.id } });
  console.log("[staff-role] change", {
    target: email,
    oldRole: prevRole?.role ?? null,
    newRole: role,
    changedBy: admin?.email ?? null,
    at: new Date().toISOString(),
  });

  await prisma.staffRole.upsert({
    where: { userId: profile.id },
    update: { role, email, assignedBy: admin?.email ?? null },
    create: { userId: profile.id, role, email, assignedBy: admin?.email ?? null },
  });
  revalidatePath("/admin/staff");
  return {
    success: `已指派 ${profile.display_name ?? email} 為${role === "OPERATOR" ? "操作人員" : "總教練"}`,
  };
}

/** 移除幹部角色（降回一般會員） */
export async function removeStaffRoleAction(userId: string) {
  await requireFullAdmin();
  await prisma.staffRole.deleteMany({ where: { userId } });
  revalidatePath("/admin/staff");
}

// ───────────────────────── 企業專區（世華會等企業包班）─────────────────────────
// 專區只管「可見性」（公開型錄隱藏、專區頁限會員）；觀看權限仍走 Enrollment 逐課開通。
// 會籍以 email（小寫）為鍵，允許尚未註冊的 email 先入名單。

export type ZoneActionState = { error?: string; success?: string } | null;

const zoneSlugSchema = z
  .string()
  .min(1, "請填寫網址代稱")
  .regex(/^[a-z0-9-]+$/, "網址代稱只能用小寫英文、數字與連字號（-）");

/** 建立企業／訂閱專區 */
export async function createZoneAction(
  _prev: ZoneActionState,
  formData: FormData,
): Promise<ZoneActionState> {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const kind = formData.get("kind") === "SUBSCRIPTION" ? "SUBSCRIPTION" : "BUSINESS";
  if (!name) return { error: "請填寫專區名稱" };
  const parsedSlug = zoneSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return { error: parsedSlug.error.issues[0].message };

  try {
    await prisma.courseGroup.create({ data: { name, slug, kind } });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { error: `網址代稱「${slug}」已被使用，請換一個` };
    }
    throw e;
  }
  revalidatePath("/admin/zones");
  revalidatePath("/admin/subscription");
  return { success: `已建立專區「${name}」` };
}

// 主題色驗證：#RGB / #RRGGBB，其他一律存 null（回全站預設色）
function parseHexColor(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v.toLowerCase() : null;
}

/** 更新專區基本資料（名稱/擋牆說明/主題配色） */
export async function updateZoneAction(zoneId: string, formData: FormData) {
  await requireEditor();
  const name = String(formData.get("name") ?? "").trim();
  const wallText = String(formData.get("wallText") ?? "").trim() || null;
  if (!name) return;
  await prisma.courseGroup.update({
    where: { id: zoneId },
    data: {
      name,
      wallText,
      themePrimary: parseHexColor(formData.get("themePrimary")),
      themeAccent: parseHexColor(formData.get("themeAccent")),
    },
  });
  revalidatePath("/admin/zones");
  revalidatePath(`/admin/zones/${zoneId}`);
}

/** 專區啟用/停用（停用 = 前台整區 404，課程仍維持隱藏） */
export async function toggleZoneActive(zoneId: string, isActive: boolean) {
  await requireEditor();
  await prisma.courseGroup.update({ where: { id: zoneId }, data: { isActive } });
  revalidatePath("/admin/zones");
  revalidatePath(`/admin/zones/${zoneId}`);
}

/** 刪除專區：課程退回一般課程（groupId SetNull），會籍/邀請碼一併刪除 */
export async function deleteZoneAction(zoneId: string) {
  await requireEditor();
  await prisma.courseGroup.delete({ where: { id: zoneId } }).catch(() => undefined);
  revalidatePath("/admin/zones");
  redirect("/admin/zones");
}

/** 單筆新增專區會員 */
export async function addZoneMemberAction(
  zoneId: string,
  _prev: ZoneActionState,
  formData: FormData,
): Promise<ZoneActionState> {
  await requireEditor();
  const admin = await getAuthUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  if (!EMAIL_RE.test(email)) return { error: "Email 格式不正確" };

  // 已是站上會員就順手回填 userId（純稽核，非必要）
  const profile = (await getProfilesByEmails([email])).get(email);

  await prisma.courseGroupMember.upsert({
    where: { groupId_email: { groupId: zoneId, email } },
    update: {},
    create: {
      groupId: zoneId,
      email,
      name,
      userId: profile?.id ?? null,
      source: "MANUAL",
      addedBy: admin?.email ?? null,
    },
  });
  // 已註冊會員：期限內課程自動開通（未註冊者於註冊時由 autoEnrollOnRegister 補上）
  if (profile?.id) {
    await autoEnrollGroupCourses(zoneId, [{ userId: profile.id }]);
  }
  revalidatePath(`/admin/zones/${zoneId}`);
  return { success: `已加入 ${email}` };
}

/** 批次匯入專區會員（textarea 貼名單，每行 email[,姓名]；冪等，重複自動略過） */
export async function importZoneMembersAction(
  zoneId: string,
  _prev: ZoneActionState,
  formData: FormData,
): Promise<ZoneActionState> {
  await requireEditor();
  const admin = await getAuthUser();
  const raw = String(formData.get("list") ?? "");
  if (!raw.trim()) return { error: "請貼上名單" };

  const rows = parseRows(raw);
  if (rows.length > MAX_BATCH_ROWS)
    return { error: `一次最多 ${MAX_BATCH_ROWS} 筆，請分批匯入` };

  const seen = new Set<string>();
  const valid = rows
    .filter((r) => EMAIL_RE.test(r.email))
    .filter((r) => !seen.has(r.email) && seen.add(r.email));
  if (valid.length === 0)
    return { error: "沒有讀到任何合法 email，請確認格式（每行 email,姓名）" };

  // 批次反查已註冊會員，順手回填 userId
  const profileMap = await getProfilesByEmails(valid.map((r) => r.email));

  const created = await prisma.courseGroupMember.createMany({
    data: valid.map((r) => ({
      groupId: zoneId,
      email: r.email,
      name: r.name || null,
      userId: profileMap.get(r.email)?.id ?? null,
      source: "IMPORT",
      addedBy: admin?.email ?? null,
    })),
    skipDuplicates: true,
  });

  // 已註冊會員：期限內課程自動開通（未註冊者於註冊時由 autoEnrollOnRegister 補上）
  await autoEnrollGroupCourses(
    zoneId,
    valid
      .map((r) => profileMap.get(r.email)?.id)
      .filter((id): id is string => !!id)
      .map((userId) => ({ userId })),
  );

  revalidatePath(`/admin/zones/${zoneId}`);
  const dup = valid.length - created.count;
  const bad = rows.length - valid.length;
  const registered = valid.filter((r) => profileMap.has(r.email)).length;
  return {
    success: `已加入 ${created.count} 筆（其中 ${registered} 位已是站上會員）${dup > 0 ? `、${dup} 筆已在名單內略過` : ""}${bad > 0 ? `、${bad} 行無法辨識已忽略` : ""}`,
  };
}

/** 移除專區會員（只影響專區可見性，已開通的 Enrollment 不動） */
export async function removeZoneMember(memberId: string, zoneId: string) {
  await requireEditor();
  await prisma.courseGroupMember.deleteMany({ where: { id: memberId } });
  revalidatePath(`/admin/zones/${zoneId}`);
  revalidatePath("/admin/members"); // 會員列表的專區徽章也會即時更新
}

// 邀請碼字元集：去除易混淆的 0/O/1/I
const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return code;
}

/** 產生專區邀請碼 */
export async function createZoneInviteAction(zoneId: string, formData: FormData) {
  await requireEditor();
  const admin = await getAuthUser();
  const label = String(formData.get("label") ?? "").trim() || null;
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59+08:00`) : null;

  // code @unique 撞碼重試（32^8 空間，實務上一次就過）
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.groupInviteCode.create({
        data: {
          groupId: zoneId,
          code: genInviteCode(),
          label,
          expiresAt,
          createdBy: admin?.email ?? null,
        },
      });
      break;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  revalidatePath(`/admin/zones/${zoneId}`);
}

/** 停用/啟用邀請碼 */
export async function toggleZoneInvite(inviteId: string, zoneId: string, isActive: boolean) {
  await requireEditor();
  await prisma.groupInviteCode.update({ where: { id: inviteId }, data: { isActive } });
  revalidatePath(`/admin/zones/${zoneId}`);
}

/** 會員列表勾選 → 批次加入企業專區（冪等，已在名單內自動略過）。
 *  rowsJson = 勾選會員的 [{id,email,name}]（client 端已有資料，免再反查） */
export async function addMembersToZoneBulkAction(
  _prev: ZoneActionState,
  formData: FormData,
): Promise<ZoneActionState> {
  await requireEditor();
  const admin = await getAuthUser();

  const zoneId = String(formData.get("zoneId") ?? "");
  const zone = await prisma.courseGroup.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true },
  });
  if (!zone) return { error: "請選擇企業專區" };

  let rows: { id?: string; email?: string; name?: string }[] = [];
  try {
    rows = JSON.parse(String(formData.get("rowsJson") ?? "[]"));
  } catch {
    return { error: "名單格式錯誤，請重新勾選後再試" };
  }

  const seen = new Set<string>();
  const valid = rows
    .map((r) => ({
      email: String(r.email ?? "").trim().toLowerCase(),
      name: String(r.name ?? "").trim() || null,
      userId: r.id || null,
    }))
    .filter((r) => EMAIL_RE.test(r.email))
    .filter((r) => !seen.has(r.email) && seen.add(r.email));
  if (valid.length === 0) return { error: "請先勾選要加入的會員" };

  const created = await prisma.courseGroupMember.createMany({
    data: valid.map((r) => ({
      groupId: zone.id,
      email: r.email,
      name: r.name,
      userId: r.userId,
      source: "MANUAL",
      addedBy: admin?.email ?? null,
    })),
    skipDuplicates: true,
  });

  // 會員列表勾選的都是已註冊會員：期限內課程自動開通
  await autoEnrollGroupCourses(
    zone.id,
    valid
      .filter((r): r is typeof r & { userId: string } => !!r.userId)
      .map((r) => ({ userId: r.userId })),
  );

  revalidatePath(`/admin/zones/${zone.id}`);
  const dup = valid.length - created.count;
  return {
    success: `已將 ${created.count} 位會員加入「${zone.name}」${dup > 0 ? `、${dup} 位原本就在名單內` : ""}`,
  };
}
