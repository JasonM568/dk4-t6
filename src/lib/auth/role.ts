// 後台角色與權限能力（capability）的單一真實來源。
//
// 三級角色：
//   admin    管理員  — 全站查看+編輯+設定（沿用 QBC public.profiles.role=admin）
//   operator 操作人員 — 查看+編輯+匯出+批次開通/群發（course StaffRole）
//   coach    總教練  — 只能查看訂單/課程清單/會員清單（course StaffRole）
//
// 本檔為純函式（client/server 皆可用）；實際查角色在 server-only 的 staff.ts。

export const ADMIN_ROLES = ["admin"] as const;

export function isAdminRole(role: string | null): boolean {
  return role !== null && (ADMIN_ROLES as readonly string[]).includes(role);
}

export type StaffRole = "admin" | "operator" | "coach";

/** 能否進後台（查看）：三種角色皆可 */
export function canAccessAdmin(role: StaffRole | null): boolean {
  return role === "admin" || role === "operator" || role === "coach";
}

/** 能否編輯/操作/匯出（訂單、課程、會員、批次開通、群發、名單群組、匯出）：管理員與操作人員 */
export function canEdit(role: StaffRole | null): boolean {
  return role === "admin" || role === "operator";
}

/** 僅限管理員（分頁管理、權限管理） */
export function isFullAdmin(role: StaffRole | null): boolean {
  return role === "admin";
}

export const STAFF_ROLE_LABEL: Record<string, string> = {
  admin: "管理員",
  operator: "操作人員",
  coach: "總教練",
};
