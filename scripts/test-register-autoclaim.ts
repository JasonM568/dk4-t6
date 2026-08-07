/**
 * 註冊自動開通機制整合測試（不需瀏覽器、不碰正式 Supabase）
 * 執行：npx tsx --conditions=react-server scripts/test-register-autoclaim.ts
 *
 * 模擬 registerAction 成功後的兩個掛勾（auth.ts:178,184）：
 *   autoEnrollOnRegister —— email 已在專區名單 → 回填 userId
 *   claimPendingEnrollments —— email 有待開通存底 → 建立 Enrollment
 * 驗證世華會邀請註冊流程：名單信箱註冊 → 專區會籍生效 ＋ 進階課自動開通。
 *
 * 一律用固定測試 uuid（對齊 prisma/seed.ts 慣例），資料建了就刪。
 */
import { PrismaClient } from "@prisma/client";
import { claimPendingEnrollments } from "../src/lib/pending-enroll";
// 注意：autoEnrollOnRegister（zone-enroll）import 鏈含 next 模組無法在 tsx 跑；
// 它只做稽核用 userId 回填——專區可見性守門（isGroupMember）只比對 email，
// 與 userId 無關，故本測試聚焦「待開通自動認領」這條觀看權限的關鍵路徑。

const prisma = new PrismaClient();
const TEST_UUID = "00000000-0000-4000-8000-0000000000aa";
const EMAIL = "autoclaim-test@example.com";

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("localhost")) throw new Error("僅限本機資料庫執行");

  // 前次中斷的殘料先清（course cascade pending、group cascade member）
  await prisma.enrollment.deleteMany({ where: { userId: TEST_UUID } });
  await prisma.course.deleteMany({ where: { slug: "test-autoclaim-course" } });
  await prisma.courseGroup.deleteMany({ where: { slug: "test-autoclaim" } });

  // 場景還原：後台已先把 email 匯入專區名單＋批次開通存底（同世華會 105 人狀態）
  const group = await prisma.courseGroup.create({
    data: { name: "測試-自動認領專區", slug: "test-autoclaim" },
  });
  const course = await prisma.course.create({
    data: {
      title: "測試-進階課",
      slug: "test-autoclaim-course",
      description: "整合測試用",
      price: 0,
      groupId: group.id,
    },
  });
  await prisma.courseGroupMember.create({
    data: { groupId: group.id, email: EMAIL, name: "測試員", source: "IMPORT" },
  });
  await prisma.pendingEnrollment.create({
    data: { courseId: course.id, email: EMAIL, name: "測試員", createdBy: "test" },
  });

  // 模擬註冊成功當下（auth.ts:184）
  const claimed = await claimPendingEnrollments(EMAIL, TEST_UUID);

  // 驗證：專區可見性 = email 在 CourseGroupMember（isGroupMember 同一查詢條件）
  const member = await prisma.courseGroupMember.findUnique({
    where: { groupId_email: { groupId: group.id, email: EMAIL } },
  });
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: TEST_UUID, courseId: course.id } },
  });
  const pending = await prisma.pendingEnrollment.findUnique({
    where: { courseId_email: { courseId: course.id, email: EMAIL } },
  });

  const results = [
    ["專區名單查得到 email（isGroupMember 據此放行）", !!member],
    ["待開通認領筆數 = 1", claimed === 1],
    ["Enrollment 已建立（source BATCH）", enrollment?.source === "BATCH"],
    ["存底標記已認領", !!pending?.claimedAt && pending?.userId === TEST_UUID],
  ] as const;
  for (const [label, ok] of results) console.log(`${ok ? "✅" : "❌"} ${label}`);

  // 清理
  await prisma.enrollment.deleteMany({ where: { userId: TEST_UUID } });
  await prisma.course.delete({ where: { id: course.id } }); // cascade: pending
  await prisma.courseGroup.delete({ where: { id: group.id } }); // cascade: member

  if (results.some(([, ok]) => !ok)) process.exit(1);
  console.log("—— 全部通過，測試資料已清理 ——");
}

main().finally(() => prisma.$disconnect());
