"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfile, getProfilesByEmails } from "@/lib/supabase/admin";
import { canPermanentlyDeleteStudent, studentDeleteConfirmation } from "@/lib/student-deletion";

export type PersonClaimState = { error?: string; success?: string } | null;
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
  revalidatePath("/admin/people"); revalidatePath(`/admin/people/student/${studentId}`); revalidatePath(`/admin/members/${userId}`);
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
  const emailProfiles = student.email ? [...(await getProfilesByEmails([student.email])).values()] : [];
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
