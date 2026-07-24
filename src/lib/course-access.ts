import "server-only";

import { prisma } from "@/lib/db";
import { currentStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin } from "@/lib/auth/role";

/**
 * 公開型錄的課程查詢條件——「所有非後台的課程列表/下單」唯一真實來源。
 * groupId 有值 = 企業專區課程（世華會等），不進公開型錄、不可購買。
 * 新增任何前台課程查詢（含 sitemap/搜尋）都必須用這裡，不要自己寫 where。
 */
export function publicCourseWhere() {
  return { isPublished: true, groupId: null } as const;
}

/** email 正規化：會籍寫入與比對兩端都必須經過這裡，否則大小寫/空白會誤擋 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 是否為某專區的會員（email 比對，已正規化） */
export async function isGroupMember(
  groupId: string,
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false;
  const member = await prisma.courseGroupMember.findUnique({
    where: {
      groupId_email: { groupId, email: normalizeEmail(email) },
    },
    select: { id: true },
  });
  return !!member;
}

/** 專區限時免開通觀看是否生效中（openToGroupUntil 未過期） */
export function groupOpenAccessActive(course: {
  groupId: string | null;
  openToGroupUntil: Date | null;
}): boolean {
  return (
    !!course.groupId &&
    !!course.openToGroupUntil &&
    course.openToGroupUntil > new Date()
  );
}

/**
 * 觀看權限唯一真實來源：Enrollment ∨（專區限時開放中且為專區會員）。
 * 管理員例外由呼叫端自行補判（避免這裡耦合 staff 查詢）。
 */
export async function canWatchCourse(
  course: { id: string; groupId: string | null; openToGroupUntil: Date | null },
  user: { id: string; email: string | null } | null
): Promise<boolean> {
  if (!user) return false;
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
    select: { id: true },
  });
  if (enrollment) return true;
  if (groupOpenAccessActive(course)) {
    return isGroupMember(course.groupId!, user.email);
  }
  return false;
}

/**
 * 專區課程守門：專區會員或後台幹部（admin/operator/coach 皆可預覽）放行。
 * 一般公開課程（groupId=null）恆為 true。
 */
export async function canViewGroupCourse(
  course: { groupId: string | null },
  user: { email: string | null } | null
): Promise<boolean> {
  if (!course.groupId) return true;
  if (await isGroupMember(course.groupId, user?.email ?? null)) return true;
  return canAccessAdmin(await currentStaffRole());
}
