import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfileRole } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/auth/role";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy 只驗「已登入」，admin 角色檢查由這層負責——
  // 這是後台唯一守門員，不可省略
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const role = await getProfileRole(user.id);
  if (!isAdminRole(role)) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4 border-b border-gray-200 pb-4">
        <span className="font-bold">⚙️ 管理後台</span>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin" className="text-gray-600 hover:text-black">
            總覽
          </Link>
          <Link href="/admin/courses" className="text-gray-600 hover:text-black">
            課程管理
          </Link>
          <Link
            href="/admin/categories"
            className="text-gray-600 hover:text-black"
          >
            課程分類
          </Link>
          <Link href="/admin/orders" className="text-gray-600 hover:text-black">
            訂單查詢
          </Link>
          <Link href="/admin/members" className="text-gray-600 hover:text-black">
            會員與等級
          </Link>
          <Link
            href="/admin/members/import"
            className="text-gray-600 hover:text-black"
          >
            會員匯入
          </Link>
          <Link
            href="/admin/enrollments"
            className="text-gray-600 hover:text-black"
          >
            批次開通
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
