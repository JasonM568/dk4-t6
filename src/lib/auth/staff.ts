import "server-only";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfileRole } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db";
import {
  isAdminRole,
  canAccessAdmin,
  canEdit,
  isFullAdmin,
  type StaffRole,
} from "./role";

/** 解析某 user 的後台有效角色：admin(QBC) > operator/coach(course StaffRole) > null */
export async function getStaffRole(userId: string): Promise<StaffRole | null> {
  // 管理員沿用 QBC profiles.role=admin（最高，不存 course StaffRole）
  if (isAdminRole(await getProfileRole(userId))) return "admin";
  const staff = await prisma.staffRole.findUnique({
    where: { userId },
    select: { role: true },
  });
  if (staff?.role === "OPERATOR") return "operator";
  if (staff?.role === "COACH") return "coach";
  return null;
}

/** 取得目前登入者的後台角色（未登入回 null） */
export async function currentStaffRole(): Promise<StaffRole | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return getStaffRole(user.id);
}

/** 目前登入者能否編輯（查看頁用來決定是否顯示編輯按鈕）：admin|operator */
export async function currentCanEdit(): Promise<boolean> {
  return canEdit(await currentStaffRole());
}

// ── server action 守門（不符就 throw，擋下越權呼叫）──

/** 進後台/查看：admin|operator|coach */
export async function requireStaff(): Promise<StaffRole> {
  const role = await currentStaffRole();
  if (!canAccessAdmin(role)) throw new Error("需要後台權限");
  return role as StaffRole;
}

/** 編輯/操作/匯出：admin|operator（總教練被擋） */
export async function requireEditor(): Promise<StaffRole> {
  const role = await currentStaffRole();
  if (!canEdit(role)) throw new Error("需要編輯權限（總教練為唯讀）");
  return role as StaffRole;
}

/** 僅限管理員：分頁管理、權限管理 */
export async function requireFullAdmin(): Promise<StaffRole> {
  const role = await currentStaffRole();
  if (!isFullAdmin(role)) throw new Error("需要管理員權限");
  return role as StaffRole;
}

// ── 頁面守門（server component 用，不符就 redirect 回後台首頁）──

export async function pageGuardEditor(): Promise<StaffRole> {
  const role = await currentStaffRole();
  if (!canEdit(role)) redirect("/admin");
  return role as StaffRole;
}

export async function pageGuardFullAdmin(): Promise<StaffRole> {
  const role = await currentStaffRole();
  if (!isFullAdmin(role)) redirect("/admin");
  return role as StaffRole;
}
