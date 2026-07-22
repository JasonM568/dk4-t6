import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin, canEdit, isFullAdmin, STAFF_ROLE_LABEL } from "@/lib/auth/role";
import { AdminSubNav } from "./admin-subnav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy 只驗「已登入」，後台角色檢查由這層負責——這是後台守門員，不可省略。
  // 三級：admin(全部) / operator(可編輯) / coach(唯讀查看)；其餘導回會員中心。
  const role = await currentStaffRole();
  if (!canAccessAdmin(role)) redirect("/dashboard");

  const editor = canEdit(role);
  const admin = isFullAdmin(role);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4 border-b border-gray-200 pb-4">
        <span className="font-bold">⚙️ 管理後台</span>
        {role && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {STAFF_ROLE_LABEL[role] ?? role}
          </span>
        )}
        <nav className="flex flex-wrap gap-4 text-sm">
          {/* 查看類：三種角色皆可 */}
          <Link href="/admin" className="text-gray-600 hover:text-black">
            總覽
          </Link>
          <Link href="/admin/courses" className="text-gray-600 hover:text-black">
            課程管理
          </Link>
          <Link href="/admin/members" className="text-gray-600 hover:text-black">
            會員管理
          </Link>
          {/* 企業專區（包班）：自成一區——專區課程/會員/邀請碼都在這裡管 */}
          {editor && (
            <Link href="/admin/zones" className="text-gray-600 hover:text-black">
              企業專區
            </Link>
          )}
          <Link href="/admin/orders" className="text-gray-600 hover:text-black">
            訂單查詢
          </Link>
          {/* 編輯/操作類：admin|operator */}
          {editor && (
            <Link
              href="/admin/broadcast"
              className="text-gray-600 hover:text-black"
            >
              Email群發
            </Link>
          )}
          {/* 僅管理員 */}
          {admin && (
            <>
              <Link
                href="/admin/settings"
                className="text-gray-600 hover:text-black"
              >
                分頁管理
              </Link>
              <Link
                href="/admin/staff"
                className="font-medium text-indigo-600 hover:text-indigo-800"
              >
                權限管理
              </Link>
            </>
          )}
        </nav>
      </div>
      <AdminSubNav canEdit={editor} />
      {children}
    </div>
  );
}
