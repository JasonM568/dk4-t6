"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 各區子分頁。依目前路徑判斷屬於哪一區，顯示對應子分頁。
// 分區邏輯：課程管理=管內容、會員管理=管人與權限、Email群發=管行銷寄送；
// 企業專區（/admin/zones）自成一區，頁內自帶導覽，不掛子分頁。
// editorOnly：僅 admin|operator 可見（總教練唯讀，隱藏編輯/操作類子分頁）
const COURSE_TABS = [
  { href: "/admin/courses", label: "課程上架" },
  { href: "/admin/categories", label: "課程分類", editorOnly: true },
];
const MEMBER_TABS = [
  { href: "/admin/members", label: "會員列表" },
  { href: "/admin/members/import", label: "會員新增", editorOnly: true },
  { href: "/admin/enrollments", label: "批次開通", editorOnly: true },
];
const BROADCAST_TABS = [
  { href: "/admin/broadcast", label: "群發與紀錄", editorOnly: true },
  { href: "/admin/broadcast/groups", label: "名單群組", editorOnly: true },
];
const WEBINAR_TABS = [
  { href: "/admin/webinars", label: "查看講座場次" },
  { href: "/admin/webinars/new", label: "建立講座", editorOnly: true },
];

const COURSE_PREFIXES = ["/admin/courses", "/admin/categories"];
const MEMBER_PREFIXES = ["/admin/members", "/admin/enrollments"];
const BROADCAST_PREFIXES = ["/admin/broadcast"];
const WEBINAR_PREFIXES = ["/admin/webinars"];

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
  } else if (isUnder(pathname, BROADCAST_PREFIXES)) {
    tabs = BROADCAST_TABS;
    title = "Email群發";
  } else if (isUnder(pathname, WEBINAR_PREFIXES)) {
    tabs = WEBINAR_TABS;
    title = "講座報名";
  }
  if (!tabs) return null;
  // 總教練（唯讀）隱藏編輯/操作類子分頁
  const visible = tabs.filter((t) => canEdit || !t.editorOnly);

  // 巢狀路徑（如 /admin/broadcast 與 /admin/broadcast/groups）只亮最長符合的那個分頁
  const activeHref = visible
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="mb-6 rounded-xl bg-gray-50 p-3">
      <div className="mb-2 px-1 text-xs font-medium text-gray-400">{title}</div>
      <nav className="flex flex-wrap gap-1">
        {visible.map((t) => {
          const active = t.href === activeHref;
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
