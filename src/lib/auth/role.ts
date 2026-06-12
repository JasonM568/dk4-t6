// role 對映的單一真實來源。
// profiles.role：admin → 可進後台；student / coach / master / tester → 一般會員。
// 日後若 coach / master 要開後台權限，只改這裡的白名單。

export const ADMIN_ROLES = ["admin"] as const;

export function isAdminRole(role: string | null): boolean {
  return role !== null && (ADMIN_ROLES as readonly string[]).includes(role);
}
