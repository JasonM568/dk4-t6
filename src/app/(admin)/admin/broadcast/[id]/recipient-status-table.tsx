"use client";

import { useState } from "react";

// 逐人投遞狀態（明細頁「收件名單」升級版）：
// 狀態取該收件人最高階事件（點擊 > 開信 > 送達），退信為終態獨立標示。
export type RecipientStatusRow = {
  email: string;
  status:
    | "CLICKED"
    | "OPENED"
    | "DELIVERED"
    | "BOUNCED"
    | "COMPLAINED"
    | "ACCEPTED"
    | "PENDING"
    | "FAILED";
  reason: string | null;
};

const STATUS_BADGE: Record<
  RecipientStatusRow["status"],
  { label: string; cls: string }
> = {
  CLICKED: { label: "已點擊", cls: "bg-indigo-100 text-indigo-800" },
  OPENED: { label: "已開信", cls: "bg-emerald-100 text-emerald-800" },
  DELIVERED: { label: "已送達", cls: "bg-green-50 text-green-700" },
  BOUNCED: { label: "退信", cls: "bg-red-100 text-red-700" },
  COMPLAINED: { label: "垃圾信檢舉", cls: "bg-red-100 text-red-700" },
  FAILED: { label: "API 失敗", cls: "bg-red-50 text-red-700" },
  ACCEPTED: { label: "等待送達回報", cls: "bg-amber-50 text-amber-700" },
  PENDING: { label: "結果不確定", cls: "bg-orange-100 text-orange-800" },
};

const FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "CLICKED", label: "已點擊" },
  { key: "OPENED", label: "已開信" },
  { key: "DELIVERED", label: "已送達" },
  { key: "BOUNCED", label: "退信" },
  { key: "COMPLAINED", label: "檢舉" },
  { key: "FAILED", label: "API 失敗" },
  { key: "ACCEPTED", label: "等待回報" },
  { key: "PENDING", label: "結果不確定" },
] as const;

export function RecipientStatusTable({ rows }: { rows: RecipientStatusRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");

  const query = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "ALL" || r.status === filter) &&
      (!query || r.email.toLowerCase().includes(query)),
  );
  const countOf = (key: string) =>
    key === "ALL" ? rows.length : rows.filter((r) => r.status === key).length;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋 email…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const n = countOf(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                disabled={n === 0 && f.key !== "ALL"}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  filter === f.key
                    ? "bg-black text-white"
                    : n === 0
                      ? "bg-gray-50 text-gray-300"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label} {n}
              </button>
            );
          })}
        </div>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2">備註</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-gray-400">
                  沒有符合的收件人
                </td>
              </tr>
            )}
            {shown.map((r, i) => {
              const badge = STATUS_BADGE[r.status];
              return (
                <tr key={r.email}>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-400">{i + 1}</td>
                  <td className="px-3 py-1.5 text-gray-700">{r.email}</td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-400">{r.reason ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
