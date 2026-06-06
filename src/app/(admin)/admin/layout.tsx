import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 縱深防禦：middleware 已擋一次，layout 再以 DB session 二次驗證
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

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
          <Link href="/admin/orders" className="text-gray-600 hover:text-black">
            訂單查詢
          </Link>
          <Link href="/admin/members" className="text-gray-600 hover:text-black">
            會員與等級
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
