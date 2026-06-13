"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import {
  getProfilesByEmails,
  findAuthUserIdByEmail,
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
import { decodeCsvBuffer } from "@/lib/csv";
import { requireEditor, requireFullAdmin } from "@/lib/auth/staff";
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
  await requireEditor();
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
  await requireEditor();
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
  await requireEditor();

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

const tierSchema = z.object({
  minTotalSpent: z.coerce.number().int().min(0),
  discountPercent: z.coerce.number().int().min(0).max(100),
});

export async function updateTier(id: string, formData: FormData) {
  await requireEditor();
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
  await prisma.enrollment.deleteMany({ where: { userId, courseId } });
  revalidatePath(`/admin/members/${userId}`);
}

export type RevokeState = { error?: string; success?: string } | null;

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

/** 為勾選的會員批次重設密碼（覆蓋原密碼；用於從未登入的會員） */
export async function bulkSetPasswordAction(
  _prev: BulkPasswordState,
  formData: FormData,
): Promise<BulkPasswordState> {
  await requireEditor();

  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const password = String(formData.get("password") ?? "").trim();

  if (userIds.length === 0) return { error: "請至少勾選一位會員" };
  if (password.length < 6) return { error: "密碼至少 6 字元" };
  if (userIds.length > 300) return { error: "一次最多 300 位，請分批" };

  const adminUser = await getAuthUser();
  let ok = 0;
  let fail = 0;
  for (const id of userIds) {
    if (await setUserPassword(id, password)) {
      ok++;
      await recordMemberPassword(id, password, adminUser?.email ?? null);
    } else fail++;
  }

  revalidatePath("/admin/members/inactive");
  if (fail > 0) return { error: `完成但有失敗：成功 ${ok}、失敗 ${fail}` };
  return { success: `已為 ${ok} 位會員設定新密碼，可用群發通知告知學員` };
}

/** 單筆重設會員密碼（會員列表用），並記錄初始密碼供後台備查 */
export async function resetMemberPasswordAction(
  userId: string,
  formData: FormData,
): Promise<void> {
  await requireEditor();
  const password = String(formData.get("password") ?? "").trim();
  if (password.length < 6) return;
  const ok = await setUserPassword(userId, password);
  if (ok) {
    const adminUser = await getAuthUser();
    await recordMemberPassword(userId, password, adminUser?.email ?? null);
  }
  revalidatePath("/admin/members");
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

// ───────────────────────── 群發通知 ─────────────────────────

export type BroadcastState = {
  error?: string;
  success?: string;
  broadcastId?: string; // 本次群發/排程的紀錄 id（手動名單存群組用）
  manualCount?: number; // 手動名單筆數（>0 時前端提醒「是否建立群組」）
} | null;

/** 群發通知：mode=test 只寄給操作的管理員本人；mode=all 寄給全部會員並留紀錄。
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
  const audience = String(formData.get("audience") ?? "all"); // all | group | manual
  const groupId = String(formData.get("groupId") ?? "");
  const manualRaw = String(formData.get("manualList") ?? "");

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

  // 測試模式：只寄給自己（發送對象與排程時間不影響測試信）
  if (mode === "test") {
    if (!admin?.email) return { error: "讀不到你的 email，無法寄測試信" };
    const html = buildBroadcastHtml(body, course);
    const r = await sendBroadcast([admin.email], `[測試] ${subject}`, html);
    return r.failed > 0
      ? { error: `測試信寄送失敗：${r.error ?? "未知錯誤"}` }
      : { success: `測試信已寄到 ${admin.email}，請收信確認版面` };
  }

  // ── 解析發送對象 ──
  let audienceType = "ALL";
  let audienceLabel = "全部會員";
  let audienceGroupId: string | null = null;
  let manualRows: { email: string; name?: string }[] | undefined;

  if (audience === "group") {
    const group = await prisma.mailGroup.findUnique({
      where: { id: groupId },
      include: { _count: { select: { members: true } } },
    });
    if (!group) return { error: "請選擇名單群組" };
    if (group._count.members === 0)
      return { error: `群組「${group.name}」沒有成員，請先到名單群組加入名單` };
    audienceType = "GROUP";
    audienceGroupId = group.id;
    audienceLabel = `群組：${group.name}`;
  } else if (audience === "manual") {
    const seen = new Set<string>();
    manualRows = parseRows(manualRaw)
      .filter((r) => EMAIL_RE.test(r.email))
      .filter((r) => !seen.has(r.email) && seen.add(r.email))
      .map((r) => (r.name ? { email: r.email, name: r.name } : { email: r.email }));
    if (manualRows.length === 0)
      return { error: "手動名單沒有任何合法的 email" };
    audienceLabel = `手動名單 ${manualRows.length} 筆`;
    audienceType = "MANUAL";
  }

  const audienceData = {
    audienceType,
    groupId: audienceGroupId,
    audienceLabel,
    manualRows: manualRows ?? undefined,
  };

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
      },
    });
    revalidatePath("/admin/broadcast");
    const shown = scheduledAt.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
    return {
      success: `已排程：${shown} 寄給「${audienceLabel}」（實際寄出最多晚 5 分鐘；全部會員/群組名單以寄出當下為準）`,
      broadcastId: record.id,
      manualCount: manualRows?.length,
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
      ...audienceData,
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH_ROWS = 500;

export type BatchRowResult = {
  email: string;
  name?: string; // 名單解析出的姓名（查無會員轉批次新增時帶入）
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
  courseId?: string; // 批次開通的課程（查無會員轉批次新增時帶入）
  courseTitle?: string;
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

  revalidatePath("/admin/members");
  return { success: `已建立會員 ${name}（${email}）` };
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
      results.push({ email: row.email, status: "created" });
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

    let userId = profileMap.get(row.email)?.id;

    // B7：profiles 查不到時，可能只是 profiles 同步延遲、帳號其實已存在。
    // 「只反查、不建立」既有 auth user id（不呼叫 createMember，避免把真的不存在的
    // email 建成隨機密碼帳號）；反查到就開通杜絕漏開，反查不到才視為查無會員。
    if (!userId) {
      userId = (await findAuthUserIdByEmail(row.email)) ?? undefined;
    }

    if (!userId) {
      results.push({
        email: row.email,
        name: row.name || undefined,
        status: "notfound",
        detail: "查無會員，可在下方一鍵批次新增並開通",
      });
      continue;
    }
    if (enrolled.has(userId)) {
      results.push({ email: row.email, status: "already", detail: "本來就有觀看權限" });
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
