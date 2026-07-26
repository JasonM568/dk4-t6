import "server-only";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/course-access";

// 專區自動開通：openToGroupUntil 在此同時是「自動開通截止時間」——
// 期限內加入專區（邀請碼/後台新增/匯入）或完成註冊者，直接寫入 Enrollment
// （source ZONE，永久有效）；期限過後新加入者不再自動開通，既有 Enrollment 不受影響。
// 所有寫入冪等（skipDuplicates），失敗不應阻斷呼叫端主流程（呼叫端自行 catch）。

/** 把使用者開通進「專區內仍在自動開通期限內」的所有課程；回傳實際新增筆數 */
export async function autoEnrollGroupCourses(
  groupId: string,
  users: { userId: string }[],
): Promise<number> {
  if (users.length === 0) return 0;
  const courses = await prisma.course.findMany({
    where: { groupId, openToGroupUntil: { gt: new Date() } },
    select: { id: true },
  });
  if (courses.length === 0) return 0;
  const res = await prisma.enrollment.createMany({
    data: users.flatMap((u) =>
      courses.map((c) => ({ userId: u.userId, courseId: c.id, source: "ZONE" })),
    ),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * 註冊完成時呼叫：email 若已在啟用中專區的名單（先前 IMPORT/MANUAL 先入名單），
 * 回填 userId（稽核用）並自動開通該專區仍在期限內的課程。
 */
export async function autoEnrollOnRegister(
  email: string,
  userId: string,
): Promise<void> {
  const memberships = await prisma.courseGroupMember.findMany({
    where: { email: normalizeEmail(email), group: { isActive: true } },
    select: { id: true, groupId: true, userId: true },
  });
  if (memberships.length === 0) return;

  const missingUserId = memberships.filter((m) => !m.userId).map((m) => m.id);
  if (missingUserId.length > 0) {
    await prisma.courseGroupMember.updateMany({
      where: { id: { in: missingUserId } },
      data: { userId },
    });
  }
  for (const m of memberships) {
    await autoEnrollGroupCourses(m.groupId, [{ userId }]);
  }
}
