import "server-only";
import { prisma } from "@/lib/db";

/** 註冊或後續登入時依 email 認領歷史學員資料；不覆寫既有歷史課程。 */
export async function claimStudentRecord(email: string, userId: string) {
  const normalized = email.trim().toLowerCase();
  const record = await prisma.studentRecord.findUnique({ where: { email: normalized } });
  if (!record || record.claimedUserId === userId) return false;
  await prisma.studentRecord.update({
    where: { id: record.id },
    data: { claimedUserId: userId, claimedAt: new Date() },
  });
  return true;
}

export async function isOldStudent(email: string | null | undefined) {
  if (!email) return false;
  const record = await prisma.studentRecord.findUnique({
    where: { email: email.trim().toLowerCase() }, select: { id: true },
  });
  return !!record;
}
