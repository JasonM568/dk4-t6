"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 第二層子分頁：頂列只放「分組」，組內所有頁面都列在這裡。
// 以後加新功能一律加進對應分組的 TABS，不要再往頂列塞。
// editorOnly：僅 admin|operator 可見（總教練唯讀，隱藏編輯/操作類子分頁）
const PLATFORM_TABS = [
  { href: "/admin/people", label: "學員與名單" },
  { href: "/admin/courses", label: "課程上架" },
  { href: "/admin/categories", label: "課程分類", editorOnly: true },
  { href: "/admin/members", label: "會員列表" },
  { href: "/admin/students", label: "學員資料庫", editorOnly: true },
  { href: "/admin/students/segments", label: "分眾圈人", editorOnly: true },
  { href: "/admin/members/import", label: "會員新增", editorOnly: true },
  { href: "/admin/enrollments", label: "批次開通", editorOnly: true },
  { href: "/admin/orders", label: "訂單查詢" },
  { href: "/admin/zones", label: "企業專區", editorOnly: true },
  { href: "/admin/subscription", label: "訂閱專區", editorOnly: true },
];
const MARKETING_TABS = [
  { href: "/admin/broadcast", label: "Email群發", editorOnly: true },
  { href: "/admin/broadcast/groups", label: "名單群組", editorOnly: true },
  { href: "/admin/webinars", label: "講座報名" },
  { href: "/admin/webinars/new", label: "建立講座", editorOnly: true },
  { href: "/admin/corporate", label: "包班諮詢" },
  { href: "/admin/sms", label: "簡訊發送", editorOnly: true },
  { href: "/admin/sms/optouts", label: "簡訊退訂", editorOnly: true },
];
const SESSION_TABS = [{ href: "/admin/sessions", label: "場次看板" }];
// 收支結算：獨立類別（2026-08-29 從場次分出）。整組 adminOnly——
// 分潤金額是內部薪酬，操作人員/總教練連分組都看不到
const FINANCE_TABS = [
  { href: "/admin/finance", label: "收支總覽", adminOnly: true },
  { href: "/admin/finance/settings", label: "費率與分潤設定", adminOnly: true },
];
const SYSTEM_TABS = [
  { href: "/admin/settings", label: "分頁管理" },
  { href: "/admin/staff", label: "權限管理" },
];

const PLATFORM_PREFIXES = [
  "/admin/people",
  "/admin/courses",
  "/admin/categories",
  "/admin/members",
  "/admin/students",
  "/admin/enrollments",
  "/admin/orders",
  "/admin/zones",
  "/admin/subscription",
];
const MARKETING_PREFIXES = ["/admin/broadcast", "/admin/webinars", "/admin/corporate", "/admin/sms"];
const SESSION_PREFIXES = ["/admin/sessions"];
const FINANCE_PREFIXES = ["/admin/finance"];
const SYSTEM_PREFIXES = ["/admin/settings", "/admin/staff"];

function isUnder(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AdminSubNav({
  canEdit = true,
  isAdmin = false,
}: {
  canEdit?: boolean;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  let tabs:
    | { href: string; label: string; editorOnly?: boolean; adminOnly?: boolean }[]
    | null = null;
  let title = "";
  if (isUnder(pathname, PLATFORM_PREFIXES)) {
    tabs = PLATFORM_TABS;
    title = "課程與會員";
  } else if (isUnder(pathname, MARKETING_PREFIXES)) {
    tabs = MARKETING_TABS;
    title = "行銷推播";
  } else if (isUnder(pathname, SESSION_PREFIXES)) {
    tabs = SESSION_TABS;
    title = "場次";
  } else if (isUnder(pathname, FINANCE_PREFIXES)) {
    tabs = FINANCE_TABS;
    title = "收支結算";
  } else if (isUnder(pathname, SYSTEM_PREFIXES)) {
    tabs = SYSTEM_TABS;
    title = "系統設定";
  }
  if (!tabs) return null;
  // 總教練（唯讀）隱藏編輯/操作類子分頁；adminOnly（收支）連操作人員也隱藏
  const visible = tabs.filter(
    (t) => (canEdit || !t.editorOnly) && (isAdmin || !t.adminOnly),
  );
  if (visible.length === 0) return null;

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
