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
        {/* 頂層只放「分組」，組內頁面由第二層子分頁列（AdminSubNav）承接——
            以後加功能一律進第二層，頂列不再變長 */}
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin" className="text-gray-600 hover:text-black">
            總覽
          </Link>
          {/* 課程與會員：課程上架/分類、會員、批次開通、訂單、企業專區 */}
          <Link href="/admin/courses" className="text-gray-600 hover:text-black">
            課程與會員
          </Link>
          {/* 行銷推播：Email群發、名單群組、講座報名、簡訊發送——皆為編輯/操作類 */}
          {editor && (
            <Link
              href="/admin/broadcast"
              className="text-gray-600 hover:text-black"
            >
              行銷推播
            </Link>
          )}
          {/* 場次看板：實體開課報名狀況（1shop 訂單匯入），三種角色皆可看 */}
          <Link href="/admin/sessions" className="text-gray-600 hover:text-black">
            場次看板
          </Link>
          {/* 收支結算：獨立類別，僅管理員（分潤金額是內部薪酬） */}
          {admin && (
            <Link href="/admin/finance" className="text-gray-600 hover:text-black">
              收支結算
            </Link>
          )}
          {/* 系統設定：分頁管理、權限管理，僅管理員 */}
          {admin && (
            <Link
              href="/admin/settings"
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              系統設定
            </Link>
          )}
        </nav>
      </div>
      <AdminSubNav canEdit={editor} isAdmin={admin} />
      {children}
    </div>
  );
}
