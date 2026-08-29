import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
try {
  const [students, enrollmentGroups] = await Promise.all([
    prisma.studentRecord.findMany({ select: { id: true, email: true, claimedUserId: true, _count: { select: { histories: true, engagements: true } } } }),
    prisma.enrollment.groupBy({ by: ["userId"], _count: { _all: true } }),
  ]);
  const enrolled = new Set(enrollmentGroups.filter((r) => r._count._all > 0).map((r) => r.userId));
  const emailCounts = new Map<string, number>();
  for (const s of students) if (s.email) emailCounts.set(s.email.toLowerCase(), (emailCounts.get(s.email.toLowerCase()) ?? 0) + 1);
  const report = {
    studentCards: students.length,
    claimedWithEnrollmentProtected: students.filter((s) => s.claimedUserId && enrolled.has(s.claimedUserId)).length,
    claimedWithoutEnrollmentPotentiallyDeletable: students.filter((s) => s.claimedUserId && !enrolled.has(s.claimedUserId)).length,
    sharedEmailCardsRequireReview: students.filter((s) => s.email && (emailCounts.get(s.email.toLowerCase()) ?? 0) > 1).length,
    emptyFootprintCards: students.filter((s) => !s.claimedUserId && s._count.histories === 0 && s._count.engagements === 0).length,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
