"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfile, getProfilesByEmailsStrict } from "@/lib/supabase/admin";
import { canPermanentlyDeleteStudent, studentBulkDeleteStatus, studentDeleteConfirmation } from "@/lib/student-deletion";
import { buildStudentMergePreview } from "@/lib/duplicate-students";

export type PersonClaimState = { error?: string; success?: string } | null;
export type BulkStudentDeleteState = {
  error?: string;
  deleted?: { id: string; name: string }[];
  protected?: { id: string; name: string; reason: string }[];
  review?: { id: string; name: string; reason: string }[];
  failed?: { id: string; name: string; reason: string }[];
} | null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** 高風險身分連結：只接受管理員在人物頁明確選定的 userId，不做 email 自動認領。 */
export async function claimStudentToMemberAction(studentId: string, userId: string, _prev: PersonClaimState, fd: FormData): Promise<PersonClaimState> {
  await requireFullAdmin();
  if (String(fd.get("confirmation")) !== "LINK") return { error: "請先勾選確認，系統不會自動合併身分" };
  const actor = await getAuthUser();
  const [student, profile, alreadyClaimed] = await Promise.all([
    prisma.studentRecord.findUnique({ where: { id: studentId } }), getProfile(userId),
    prisma.studentRecord.findFirst({ where: { claimedUserId: userId, id: { not: studentId } }, select: { id: true, name: true } }),
  ]);
  if (!student) return { error: "找不到歷史學員資料" };
  if (!profile) return { error: "找不到目標會員帳號" };
  if (profile.role === "admin") return { error: "不可把學員資料認領給管理員帳號" };
  if (student.claimedUserId && student.claimedUserId !== userId) return { error: "這筆學員資料已連結其他會員，未變更" };
  if (alreadyClaimed) return { error: `此會員已連結另一張學員卡${alreadyClaimed.name ? `（${alreadyClaimed.name}）` : ""}；請先人工整理重複資料` };
  if (student.claimedUserId === userId) return { success: "這筆資料已經連結此會員" };
  await prisma.$transaction(async (tx) => {
    const after = await tx.studentRecord.update({ where: { id: studentId }, data: { claimedUserId: userId, claimedAt: new Date() } });
    await tx.studentDataAuditLog.create({ data: { studentId, action: "STUDENT_CLAIM", actorEmail: actor?.email ?? null, beforeJson: json(student), afterJson: json(after) } });
  });
  revalidatePath("/admin/people"); revalidatePath("/admin/people/duplicates"); revalidatePath(`/admin/people/student/${studentId}`); revalidatePath(`/admin/members/${userId}`);
  return { success: `已人工確認連結至 ${profile.email ?? profile.display_name ?? "會員帳號"}` };
}

/** 永久刪除的範圍只限 StudentRecord 卡片及 cascade 的歷史／接觸紀錄，不刪會員帳號或其他 domain。 */
export async function permanentlyDeleteStudentAction(studentId: string, _prev: PersonClaimState, fd: FormData): Promise<PersonClaimState> {
  await requireFullAdmin();
  const actor = await getAuthUser();
  if (!actor) return { error: "登入狀態已失效，請重新登入" };
  const reason = String(fd.get("reason") ?? "").trim();
  const confirmation = String(fd.get("confirmation") ?? "").trim();
  if (reason.length < 2) return { error: "請填寫刪除原因" };
  const student = await prisma.studentRecord.findUnique({
    where: { id: studentId },
    include: { histories: true, engagements: true },
  });
  if (!student) return { error: "查無這筆學員名單，可能已被刪除" };
  const expected = studentDeleteConfirmation(student.name, student.email);
  if (confirmation.toLowerCase() !== expected.toLowerCase()) return { error: `請輸入「${expected}」確認永久刪除` };

  // 未認領但 Email 已對到會員時也納入保護；Email 不用來合併人物，只用來阻止危險刪除。
  let emailProfiles;
  try { emailProfiles = student.email ? [...(await getProfilesByEmailsStrict([student.email])).values()] : []; }
  catch { return { error: "會員與影片權限查核暫時失敗，為避免誤刪，本次沒有刪除任何資料" }; }
  const protectedUserIds = [...new Set([student.claimedUserId, ...emailProfiles.map((p) => p.id)].filter((v): v is string => Boolean(v)))];
  try {
    await prisma.$transaction(async (tx) => {
      const enrollmentCount = protectedUserIds.length
        ? await tx.enrollment.count({ where: { userId: { in: protectedUserIds } } })
        : 0;
      if (!canPermanentlyDeleteStudent({ linkedOrCandidateEnrollmentCount: enrollmentCount })) {
        throw new Error("PROTECTED_BY_ENROLLMENT");
      }
      await tx.studentDataAuditLog.create({ data: {
        studentId, action: "STUDENT_PERMANENT_DELETE", actorEmail: actor.email ?? null,
        beforeJson: json({ student: { id: student.id, name: student.name, email: student.email, phone: student.phone,
          claimedUserId: student.claimedUserId, legacyAccessStatus: student.legacyAccessStatus, archivedAt: student.archivedAt },
          historyCount: student.histories.length, engagementCount: student.engagements.length, reason }),
      } });
      await tx.studentRecord.delete({ where: { id: studentId } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROTECTED_BY_ENROLLMENT") {
      return { error: "禁止刪除：此人物已註冊且有課程觀看權限。請改用封存。" };
    }
    throw error;
  }
  revalidatePath("/admin/people"); revalidatePath("/admin/students"); revalidatePath("/admin/students/segments");
  redirect("/admin/people?deleted=1");
}

export async function bulkPermanentlyDeleteStudentsAction(_prev: BulkStudentDeleteState, fd: FormData): Promise<BulkStudentDeleteState> {
  await requireFullAdmin();
  const actor = await getAuthUser();
  if (!actor) return { error: "登入狀態已失效，請重新登入" };
  const studentIds = [...new Set(fd.getAll("studentIds").map(String).filter(Boolean))];
  const reason = String(fd.get("reason") ?? "").trim();
  if (studentIds.length === 0) return { error: "請至少選擇一筆學員名單" };
  if (studentIds.length > 50) return { error: "每批最多 50 筆，請縮小選取範圍" };
  if (reason.length < 2) return { error: "請填寫這批名單的刪除原因" };
  if (String(fd.get("confirmation") ?? "").trim().toUpperCase() !== `DELETE ${studentIds.length}`) {
    return { error: `請輸入「DELETE ${studentIds.length}」確認本批操作` };
  }
  const students = await prisma.studentRecord.findMany({
    where: { id: { in: studentIds } },
    include: { histories: true, engagements: true },
  });
  const labels = new Map(students.map((s) => [s.id, s.name || s.email || s.phone || s.id]));
  const missing = studentIds.filter((id) => !labels.has(id));
  const emails = [...new Set(students.map((s) => s.email?.trim().toLowerCase()).filter((v): v is string => Boolean(v)))];
  let profilesByEmail;
  let sameEmailStudents;
  try {
    [profilesByEmail, sameEmailStudents] = await Promise.all([
      getProfilesByEmailsStrict(emails),
      emails.length ? prisma.studentRecord.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true } }) : [],
    ]);
  } catch {
    return { error: "會員與影片權限查核暫時失敗，為避免誤刪，本批沒有刪除任何資料" };
  }
  const emailCounts = new Map<string, number>();
  for (const row of sameEmailStudents) { const key = row.email?.toLowerCase(); if (key) emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1); }
  const userIds = [...new Set(students.flatMap((s) => [s.claimedUserId, s.email ? profilesByEmail.get(s.email.toLowerCase())?.id : null]).filter((v): v is string => Boolean(v)))];
  const enrollmentGroups = userIds.length ? await prisma.enrollment.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } }) : [];
  const enrollmentByUser = new Map(enrollmentGroups.map((r) => [r.userId, r._count._all]));
  const deleted: NonNullable<BulkStudentDeleteState>["deleted"] = [];
  const protectedRows: NonNullable<BulkStudentDeleteState>["protected"] = [];
  const review: NonNullable<BulkStudentDeleteState>["review"] = [];
  const failed: NonNullable<BulkStudentDeleteState>["failed"] = missing.map((id) => ({ id, name: id, reason: "資料不存在或已刪除" }));

  for (const student of students) {
    const name = labels.get(student.id)!;
    const email = student.email?.toLowerCase() ?? null;
    const candidateId = email ? profilesByEmail.get(email)?.id : null;
    const protectedIds = [...new Set([student.claimedUserId, candidateId].filter((v): v is string => Boolean(v)))];
    const status = studentBulkDeleteStatus({ enrollmentCount: protectedIds.reduce((sum, id) => sum + (enrollmentByUser.get(id) ?? 0), 0), identityConflict: Boolean(email && (emailCounts.get(email) ?? 0) > 1) });
    if (status === "PROTECTED") {
      protectedRows.push({ id: student.id, name, reason: "已註冊且有課程觀看權限" }); continue;
    }
    if (status === "REVIEW") {
      review.push({ id: student.id, name, reason: "同 Email 有多張學員卡，需逐筆人工確認" }); continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        const freshEnrollmentCount = protectedIds.length ? await tx.enrollment.count({ where: { userId: { in: protectedIds } } }) : 0;
        if (freshEnrollmentCount > 0) throw new Error("PROTECTED_BY_ENROLLMENT");
        await tx.studentDataAuditLog.create({ data: { studentId: student.id, action: "STUDENT_PERMANENT_DELETE_BULK", actorEmail: actor.email ?? null,
          beforeJson: json({ student: { id: student.id, name: student.name, email: student.email, phone: student.phone, claimedUserId: student.claimedUserId,
            legacyAccessStatus: student.legacyAccessStatus, archivedAt: student.archivedAt }, historyCount: student.histories.length,
            engagementCount: student.engagements.length, reason }) } });
        await tx.studentRecord.delete({ where: { id: student.id } });
      });
      deleted.push({ id: student.id, name });
    } catch (error) {
      if (error instanceof Error && error.message === "PROTECTED_BY_ENROLLMENT") protectedRows.push({ id: student.id, name, reason: "執行前新增加影片權限，已自動略過" });
      else failed.push({ id: student.id, name, reason: "刪除失敗，資料未變更" });
    }
  }
  revalidatePath("/admin/people"); revalidatePath("/admin/students"); revalidatePath("/admin/students/segments");
  return { deleted, protected: protectedRows, review, failed };
}

export async function mergeStudentRecordsAction(sourceId: string, targetId: string, _prev: PersonClaimState, fd: FormData): Promise<PersonClaimState> {
  await requireFullAdmin();
  const actor = await getAuthUser();
  if (!actor) return { error: "登入狀態已失效，請重新登入" };
  if (sourceId === targetId) return { error: "來源與保留卡不能相同" };
  if (String(fd.get("confirmation") ?? "") !== "MERGE") return { error: "請勾選確認人工合併" };
  const [source, target] = await Promise.all([
    prisma.studentRecord.findUnique({ where: { id: sourceId }, include: { histories: true, engagements: true } }),
    prisma.studentRecord.findUnique({ where: { id: targetId }, include: { histories: true, engagements: true } }),
  ]);
  if (!source || !target) return { error: "來源或保留學員卡不存在" };
  const preview = buildStudentMergePreview(source, target);
  if (!preview.canMerge) return { error: `禁止合併：${preview.conflicts.join("、")}` };
  const { moveHistories, moveEngagements } = preview;
  await prisma.$transaction(async (tx) => {
    if (moveHistories.length) await tx.studentCourseHistory.updateMany({ where: { id: { in: moveHistories.map((h) => h.id) } }, data: { studentId: targetId } });
    if (moveEngagements.length) await tx.studentEngagement.updateMany({ where: { id: { in: moveEngagements.map((e) => e.id) } }, data: { studentId: targetId } });
    await tx.studentDataAuditLog.create({ data: { studentId: sourceId, action: "STUDENT_MERGED_INTO", actorEmail: actor.email ?? null, beforeJson: json(source), afterJson: json({ targetId }) } });
    // 先刪來源卡，才能把來源的 unique phone 安全補到保留卡；已搬走的子紀錄不會被 cascade。
    await tx.studentRecord.delete({ where: { id: sourceId } });
    const after = await tx.studentRecord.update({ where: { id: targetId }, data: { name: target.name || source.name, phone: target.phone || source.phone, email: target.email || source.email,
      claimedUserId: target.claimedUserId || source.claimedUserId, claimedAt: target.claimedAt || source.claimedAt,
      legacyAccessStatus: target.legacyAccessStatus === "UNKNOWN" ? source.legacyAccessStatus : target.legacyAccessStatus,
      legacyNote: [target.legacyNote, source.legacyNote].filter(Boolean).join("\n") || null } });
    await tx.studentDataAuditLog.create({ data: { studentId: targetId, action: "STUDENT_MERGE_TARGET", actorEmail: actor.email ?? null,
      beforeJson: json(target), afterJson: json({ ...after, mergedFrom: sourceId, movedHistories: moveHistories.length, movedEngagements: moveEngagements.length,
        duplicateHistoriesRemoved: preview.duplicateHistories.length, duplicateEngagementsRemoved: preview.duplicateEngagements.length }) } });
  });
  revalidatePath("/admin/people"); revalidatePath(`/admin/people/student/${targetId}`); revalidatePath("/admin/students");
  const returnTo = String(fd.get("returnTo") ?? "");
  redirect(returnTo === "/admin/people/duplicates" ? `${returnTo}?merged=1` : `/admin/people/student/${targetId}?merged=1`);
}
