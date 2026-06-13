"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  addMembersToGroupAction,
  resetMemberPasswordAction,
  type AddToGroupState,
} from "@/actions/admin";
import { formatNT, formatDate } from "@/lib/format";

export type MemberRow = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  tierName: string | null;
  totalSpent: number;
  coursesBought: number;
  initialPassword: string | null;
  lastSignInAt: string | null;
};

export function MemberTable({
  members,
  groups,
  canEdit = true,
}: {
  members: MemberRow[];
  groups: { id: string; name: string }[];
  canEdit?: boolean; // 總教練(唯讀)為 false：隱藏勾選/加群組/重設密碼
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState<AddToGroupState, FormData>(
    addMembersToGroupAction,
    null,
  );
  const [resetting, startReset] = useTransition();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggleReveal = (id: string) =>
    setRevealed((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = members.length > 0 && selected.size === members.length;
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(members.map((m) => m.id)));

  function resetPassword(m: MemberRow) {
    const pw = window.prompt(
      `為 ${m.email ?? m.displayName} 設定新密碼（至少 6 字元）：`,
    );
    if (pw == null) return;
    if (pw.trim().length < 6) {
      alert("密碼至少 6 字元");
      return;
    }
    const fd = new FormData();
    fd.set("password", pw.trim());
    startReset(() => resetMemberPasswordAction(m.id, fd));
  }

  return (
    <form action={formAction}>
      {/* 勾選操作列：加入名單群組（總教練唯讀時隱藏） */}
      {canEdit && (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 p-3 text-sm">
        <span className="font-medium">已勾選 {selected.size} 位</span>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="userIds" value={id} />
        ))}
        <span className="text-gray-400">→ 加入名單群組：</span>
        <input
          name="newName"
          placeholder="新群組名稱"
          className="w-36 rounded border border-gray-300 px-2 py-1"
        />
        {groups.length > 0 && (
          <select
            name="groupId"
            defaultValue=""
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="">或選既有群組</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={pending || selected.size === 0}
          className="rounded-lg bg-black px-3 py-1.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-40"
        >
          {pending ? "加入中…" : "加入群組"}
        </button>
        {state?.success && (
          <span className="text-green-700">✓ {state.success}</span>
        )}
        {state?.error && <span className="text-red-600">{state.error}</span>}
      </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              {canEdit && (
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="全選"
                  />
                </th>
              )}
              <th className="px-4 py-3">會員</th>
              <th className="px-4 py-3">最後登入</th>
              <th className="px-4 py-3">等級</th>
              <th className="px-4 py-3">累積消費</th>
              <th className="px-4 py-3">購課</th>
              <th className="px-4 py-3">初始密碼</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-gray-100 ${resetting ? "opacity-60" : ""}`}>
            {members.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="px-4 py-6 text-center text-gray-400">
                  查無符合條件的會員
                </td>
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.id} className={selected.has(m.id) ? "bg-indigo-50" : ""}>
                {canEdit && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      aria-label={`選擇 ${m.email}`}
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="font-medium">{m.displayName ?? "—"}</div>
                  <div className="text-xs text-gray-400">{m.email}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {m.lastSignInAt ? (
                    formatDate(m.lastSignInAt)
                  ) : (
                    <span className="text-amber-600">從未登入</span>
                  )}
                </td>
                <td className="px-4 py-3">{m.tierName ?? "—"}</td>
                <td className="px-4 py-3">{formatNT(m.totalSpent)}</td>
                <td className="px-4 py-3">{m.coursesBought}</td>
                <td className="px-4 py-3">
                  {m.initialPassword ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {revealed.has(m.id) ? m.initialPassword : "••••••"}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleReveal(m.id)}
                        className="text-xs text-gray-500 hover:underline"
                        aria-label={revealed.has(m.id) ? "隱藏密碼" : "顯示密碼"}
                      >
                        {revealed.has(m.id) ? "隱藏" : "顯示"}
                      </button>
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {m.role === "admin" ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                      管理員
                    </span>
                  ) : (
                    (m.role ?? "會員")
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => resetPassword(m)}
                      disabled={resetting}
                      className="mr-3 text-gray-500 hover:underline disabled:opacity-50"
                    >
                      重設密碼
                    </button>
                  )}
                  <Link
                    href={`/admin/members/${m.id}`}
                    className="text-indigo-600 hover:underline"
                  >
                    檢視
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
