import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./logout-button";

export async function Navbar() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold">
            🎓 學習平台
          </Link>
          <Link
            href="/courses"
            className="text-sm text-gray-600 transition hover:text-black"
          >
            課程
          </Link>
          {user && (
            <Link
              href="/my-courses"
              className="text-sm text-gray-600 transition hover:text-black"
            >
              我的課程
            </Link>
          )}
          {user?.role === "ADMIN" && (
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
                {user.name ?? user.email}
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
