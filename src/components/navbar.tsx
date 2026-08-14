import Link from "next/link";
import { getAuthUser } from "@/lib/supabase/server";
import { getStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin } from "@/lib/auth/role";
import { getPageStates } from "@/lib/site-pages";
import { prisma } from "@/lib/db";
import { LogoutButton } from "./logout-button";

export async function Navbar() {
  const user = await getAuthUser();
  // 後台連結：三級角色都要看得到（admin 走 QBC profiles.role，operator/coach 走 StaffRole）——
  // 只查 profiles.role 的話，新指派的操作人員／總教練進得去卻看不到入口。
  // 這裡只影響顯示，真正守門在 (admin)/layout。
  const staffRole = user ? await getStaffRole(user.id) : null;
  const isStaff = canAccessAdmin(staffRole);
  // 前台分頁（量子講師群/知識專區/講座邀約）：後台「分頁管理」可開關
  const sitePages = (await getPageStates()).filter((p) => p.enabled);
  // 自訂分頁（分頁管理自建）：navbar 在 root layout，查詢失敗降級為不顯示、不炸整站
  const customPages = await prisma.customPage
    .findMany({
      where: { isPublished: true, showInNav: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, slug: true, title: true },
    })
    .catch(() => []);
  const subscriptionZone = user?.email
    ? await prisma.courseGroupMember.findFirst({
        where: { email: user.email.toLowerCase(), group: { isActive: true, kind: "SUBSCRIPTION" } },
        include: { group: { select: { slug: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }).catch(() => null)
    : null;

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/hope-academy-logo-email.jpg"
              alt="希望學院"
              className="h-8 w-8 rounded-full"
            />
            希望學院學習平台
          </Link>
          <Link
            href="/courses"
            className="text-sm text-gray-600 transition hover:text-black"
          >
            課程
          </Link>
          {sitePages.map((p) => (
            <Link
              key={p.key}
              href={p.path}
              className="text-sm text-gray-600 transition hover:text-black"
            >
              {p.title}
            </Link>
          ))}
          {customPages.map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.slug}`}
              className="text-sm text-gray-600 transition hover:text-black"
            >
              {p.title}
            </Link>
          ))}
          {user && (
            <Link
              href="/my-courses"
              className="text-sm text-gray-600 transition hover:text-black"
            >
              我的課程
            </Link>
          )}
          {subscriptionZone && (
            <Link
              href={`/zone/${subscriptionZone.group.slug}`}
              className="text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
            >
              訂閱專區
            </Link>
          )}
          {isStaff && (
            <Link
              href="/admin"
              className="text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
            >
              管理後台
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 transition hover:text-black"
              >
                {user.displayName ?? user.email}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm text-gray-600 transition hover:text-black"
              >
                登入
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                註冊
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
