"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/admin";

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
