"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { normalizeMobile } from "@/lib/sms/phone";
import { compatibleName } from "@/lib/session-history-sync";

export type SessionHistorySyncState = { error?: string; created?: number; skipped?: number; conflicts?: number } | null;
export async function syncSessionHistoryAction(sessionId: string, _prev: SessionHistorySyncState, fd: FormData): Promise<SessionHistorySyncState> {
  await requireEditor();
  const signupIds = [...new Set(fd.getAll("signupIds").map(String).filter(Boolean))];
  if (!signupIds.length) return { error: "請至少選擇一位有效報名者" };
  const session = await prisma.courseSession.findUnique({ where: { id: sessionId }, include: { signups: { where: { id: { in: signupIds }, isStaff: false, deferredToSessionId: null } } } });
  if (!session) return { error: "找不到場次" };
  let created = 0, skipped = 0, conflicts = 0;
  for (const signup of session.signups) {
    const phone = normalizeMobile(signup.phone); const email = signup.email?.trim().toLowerCase() || null;
    if (!phone && !email) { conflicts++; continue; }
    let student = phone ? await prisma.studentRecord.findUnique({ where: { phone } }) : null;
    if (student && !compatibleName(student.name, signup.name)) student = null;
    if (!student && email) {
      const matches = await prisma.studentRecord.findMany({ where: { email }, orderBy: { createdAt: "asc" } });
      const compatible = matches.filter((s) => compatibleName(s.name, signup.name));
      if (compatible.length > 1 || (matches.length > 0 && compatible.length === 0)) { conflicts++; continue; }
      student = compatible[0] ?? null;
    }
    if (!student) student = await prisma.studentRecord.create({ data: { name: signup.name, phone: phone || null, email } });
    const exists = await prisma.studentCourseHistory.findFirst({ where: { studentId: student.id, courseName: session.title, attendedAt: session.eventDate } });
    if (exists) { skipped++; continue; }
    await prisma.$transaction([
      prisma.studentCourseHistory.create({ data: { studentId: student.id, courseName: session.title, attendedAt: session.eventDate, source: "SESSION", note: `場次名單同步：${session.id}` } }),
      prisma.studentDataAuditLog.create({ data: { studentId: student.id, action: "SESSION_HISTORY_SYNC", afterJson: { sessionId: session.id, signupId: signup.id, courseName: session.title } } }),
    ]);
    created++;
  }
  revalidatePath(`/admin/sessions/${sessionId}/history-sync`); revalidatePath("/admin/people"); revalidatePath("/admin/students");
  return { created, skipped, conflicts };
}
