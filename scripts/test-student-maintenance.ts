/**
 * 學員維護資料模型回歸：
 * 1. 正式履歷與其他接觸分表；2. 主檔刪除時兩者 cascade；3. audit 不被 cascade。
 * 用法：npx tsx scripts/test-student-maintenance.ts（只允許 localhost DB）
 */
import { PrismaClient } from "@prisma/client";

if (!/@localhost[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("安全鎖：只允許 localhost DATABASE_URL");
}

const prisma = new PrismaClient();
const marker = `TEST-STUDENT-MAINT-${Date.now()}`;

async function main() {
  const student = await prisma.studentRecord.create({
    data: {
      name: marker,
      email: `${marker.toLowerCase()}@example.com`,
      legacyAccessStatus: "TO_MIGRATE",
      legacyNote: "測試資料，不含密碼",
      histories: { create: { courseName: "TEST 正式課程", source: "MANUAL" } },
      engagements: { create: { type: "BOOK_CLUB", title: "TEST 讀冊會", source: "MANUAL" } },
    },
    include: { histories: true, engagements: true },
  });
  if (student.histories.length !== 1 || student.engagements.length !== 1) {
    throw new Error("正式履歷與接觸紀錄建立失敗");
  }

  const audit = await prisma.studentDataAuditLog.create({
    data: { studentId: student.id, action: "STUDENT_UPDATE", actorEmail: "test@localhost", afterJson: { marker } },
  });
  await prisma.studentRecord.delete({ where: { id: student.id } });

  const [historyCount, engagementCount, preservedAudit] = await Promise.all([
    prisma.studentCourseHistory.count({ where: { studentId: student.id } }),
    prisma.studentEngagement.count({ where: { studentId: student.id } }),
    prisma.studentDataAuditLog.findUnique({ where: { id: audit.id } }),
  ]);
  if (historyCount || engagementCount) throw new Error("主檔刪除後子紀錄未 cascade");
  if (!preservedAudit) throw new Error("主檔刪除後 audit 不應消失");
  await prisma.studentDataAuditLog.delete({ where: { id: audit.id } });
  console.log("✓ student maintenance schema regression passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
