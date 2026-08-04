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
    // 後台統一容器：所有類別頁共用同一個左右留白（手機 24px / 平板 32px / 桌機 48px），
    // 各頁內部不要再自訂外層 padding，維持左緣一致
    <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8 lg:px-12">
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
          {/* 簡訊發送：上課提醒（場次報名者）；未接簡訊商時為測試模式，不會實際送出 */}
          {editor && (
            <Link href="/admin/sms" className="text-gray-600 hover:text-black">
              簡訊發送
            </Link>
          )}
          {/* 場次看板：實體開課報名狀況（1shop 訂單匯入），三種角色皆可看 */}
          <Link href="/admin/sessions" className="text-gray-600 hover:text-black">
            場次看板
          </Link>
          {/* 講座報名頁：訪客留 email 索取講座連結 */}
          {editor && (
            <Link href="/admin/webinars" className="text-gray-600 hover:text-black">
              講座報名
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
