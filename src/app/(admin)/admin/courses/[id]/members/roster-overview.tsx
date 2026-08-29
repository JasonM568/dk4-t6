"use client";

import { useState } from "react";
import type { CourseRosterRow, CourseRosterStatus } from "@/lib/course-roster";

const META: Record<CourseRosterStatus, { label: string; className: string }> = {
  ENROLLED: { label: "已開通", className: "bg-emerald-50 text-emerald-700" },
  PENDING_REGISTRATION: { label: "待註冊", className: "bg-amber-50 text-amber-700" },
  POSSIBLE_MISSING: { label: "可能漏開通", className: "bg-red-50 text-red-700" },
  UNRESOLVED_IDENTITY: { label: "身分待確認", className: "bg-purple-50 text-purple-700" },
};

export function RosterOverview({ rows }: { rows: CourseRosterRow[] }) {
  const [filter, setFilter] = useState<CourseRosterStatus | "ALL">("ALL");
  const counts = Object.fromEntries(Object.keys(META).map((status) => [status, rows.filter((r) => r.status === status).length])) as Record<CourseRosterStatus, number>;
  const visible = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);
  return <section className="mb-5 overflow-hidden rounded-xl border border-gray-200">
    <div className="border-b bg-gray-50 p-4"><h2 className="font-bold">開通作業總覽</h2><p className="mt-1 text-xs text-gray-500">帳號、場次名單與影片權限分開判斷；「可能漏開通」只提醒，不會未經確認自動授權。</p>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setFilter("ALL")} className={`rounded-full px-3 py-1 text-xs ${filter === "ALL" ? "bg-black text-white" : "bg-white text-gray-600"}`}>全部 {rows.length}</button>{(Object.keys(META) as CourseRosterStatus[]).map((status) => <button key={status} onClick={() => setFilter(status)} className={`rounded-full px-3 py-1 text-xs ${filter === status ? "bg-black text-white" : META[status].className}`}>{META[status].label} {counts[status]}</button>)}</div>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-white text-left text-xs text-gray-400"><tr><th className="px-4 py-2">姓名</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">狀態</th><th className="px-4 py-2">來源／說明</th></tr></thead><tbody className="divide-y divide-gray-100">{visible.map((row) => <tr key={row.key}><td className="px-4 py-2">{row.name ?? "—"}</td><td className="px-4 py-2 text-gray-500">{row.email ?? "—"}</td><td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${META[row.status].className}`}>{META[row.status].label}</span></td><td className="px-4 py-2"><span className="text-gray-700">{row.source}</span><span className="ml-2 text-xs text-gray-400">{row.detail}</span></td></tr>)}{!visible.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">此分類目前沒有資料</td></tr>}</tbody></table></div>
  </section>;
}
