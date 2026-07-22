"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 課程管理 / 會員管理 各自的子分頁。
// 依目前路徑判斷屬於哪一區，顯示對應子分頁；其他頁（總覽/訂單/群發/分頁管理）不顯示。
// editorOnly：僅 admin|operator 可見（總教練唯讀，隱藏編輯/操作類子分頁）
const COURSE_TABS = [
  { href: "/admin/courses", label: "課程上架" },
  { href: "/admin/categories", label: "課程分類", editorOnly: true },
  { href: "/admin/enrollments", label: "批次開通", editorOnly: true },
  { href: "/admin/zones", label: "企業專區", editorOnly: true },
];
const MEMBER_TABS = [
  { href: "/admin/members", label: "會員列表" },
  { href: "/admin/members/import", label: "會員新增", editorOnly: true },
  { href: "/admin/broadcast/groups", label: "名單群組", editorOnly: true },
];

const COURSE_PREFIXES = ["/admin/courses", "/admin/categories", "/admin/enrollments", "/admin/zones"];
const MEMBER_PREFIXES = ["/admin/members", "/admin/broadcast/groups"];

function isUnder(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AdminSubNav({ canEdit = true }: { canEdit?: boolean }) {
  const pathname = usePathname();
  let tabs:
    | { href: string; label: string; editorOnly?: boolean }[]
    | null = null;
  let title = "";
  if (isUnder(pathname, COURSE_PREFIXES)) {
    tabs = COURSE_TABS;
    title = "課程管理";
  } else if (isUnder(pathname, MEMBER_PREFIXES)) {
    tabs = MEMBER_TABS;
    title = "會員管理";
  }
  if (!tabs) return null;
  // 總教練（唯讀）隱藏編輯/操作類子分頁
  const visible = tabs.filter((t) => canEdit || !t.editorOnly);

  return (
    <div className="mb-6 rounded-xl bg-gray-50 p-3">
      <div className="mb-2 px-1 text-xs font-medium text-gray-400">{title}</div>
      <nav className="flex flex-wrap gap-1">
        {visible.map((t) => {
          const active =
            pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-black text-white"
                  : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
