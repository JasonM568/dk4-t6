import "server-only";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { buildPersonRoster } from "@/lib/person-roster";

export async function loadPersonRoster() {
  const [profiles, memberPhones, students, enrollmentGroups, pendingRows, memberArchives] = await Promise.all([
    listProfiles(),
    prisma.memberProfile.findMany({ select: { userId: true, phone: true } }),
    prisma.studentRecord.findMany({ select: { id: true, claimedUserId: true, name: true, email: true, phone: true,
      archivedAt: true, legacyAccessStatus: true, _count: { select: { histories: true, engagements: true } } } }),
    prisma.enrollment.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.pendingEnrollment.findMany({ where: { claimedAt: null }, select: { email: true, name: true } }),
    prisma.memberArchive.findMany({ select: { userId: true } }),
  ]);
  const pendingMap = new Map<string, { email: string; name: string | null; count: number }>();
  for (const row of pendingRows) { const key = row.email.toLowerCase(); const cur = pendingMap.get(key);
    pendingMap.set(key, { email: key, name: cur?.name ?? row.name, count: (cur?.count ?? 0) + 1 }); }
  return buildPersonRoster({ profiles, memberPhones,
    students: students.map((s) => ({ ...s, historyCount: s._count.histories, engagementCount: s._count.engagements })),
    enrollmentCounts: enrollmentGroups.map((r) => ({ userId: r.userId, count: r._count._all })),
    pending: [...pendingMap.values()], archivedUserIds: memberArchives.map((r) => r.userId) });
}
