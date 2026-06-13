"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  batchEnrollAction,
  batchRevokeEnrollmentAction,
  type BatchState,
  type RevokeState,
} from "@/actions/admin";
import { BatchResultTable } from "@/components/admin/batch-result-table";
import { enrollmentSource, formatDate } from "@/lib/format";

export type CourseMemberRow = {
  userId: string;
  name: string | null;
  email: string | null;
  source: string | null;
  orderId: string | null;
  createdAt: string;
};

export function CourseMembersManager({
  courseId,
  members,
  canEdit = true,
}: {
  courseId: string;
  members: CourseMemberRow[];
  canEdit?: boolean; // 總教練(唯讀)為 false：只看名單，隱藏新增/移除/勾選
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addState, addAction, adding] = useActionState<BatchState, FormData>(
    batchEnrollAction,
    null,
  );
  const [revokeState, revokeAction, revoking] = useActionState<
    RevokeState,
    FormData
  >(batchRevokeEnrollmentAction.bind(null, courseId), null);

  const allSelected = members.length > 0 && selected.size === members.length;
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(members.map((m) => m.userId)));

  return (
    <>
      {/* 新增觀看名單（總教練唯讀時隱藏） */}
      {canEdit && (
      <form
        action={addAction}
        className="mb-6 space-y-2 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <input type="hidden" name="courseId" value={courseId} />
        <label className="block text-sm font-medium">
          新增觀看名單（一行一個 email，可「email,姓名」格式）
        </label>
        <textarea
          name="list"
          rows={4}
          required
          placeholder={"student1@example.com\nstudent2@example.com,王小明"}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
        <p className="text-xs text-gray-400">
          已開通的會員會自動略過；查無會員的需先到「會員新增」建帳號（或用批次開通頁的一鍵新增並開通）
        </p>
        <button
          type="submit"
          disabled={adding}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {adding ? "開通中，請勿關閉頁面…" : "新增到觀看名單"}
        </button>
        {addState?.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {addState.error}
          </div>
        )}
        {addState?.summary && (
          <div className="space-y-2">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium">
              {addState.summary}
            </div>
            {addState.results && <BatchResultTable results={addState.results} />}
          </div>
        )}
      </form>
      )}

      {/* 名單 + 勾選移除 */}
      <form action={revokeAction}>
        {canEdit && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm text-gray-500">已勾選 {selected.size} 位</span>
          <button
            type="submit"
            disabled={revoking || selected.size === 0}
            onClick={(e) => {
              if (
                !confirm(
                  `確定移除勾選的 ${selected.size} 位會員的觀看權限？\n（移除購買來源的權限前請特別確認）`,
                )
              )
                e.preventDefault();
            }}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-40"
          >
            {revoking ? "移除中…" : "移除勾選的觀看權限"}
          </button>
          {revokeState?.success && (
            <span className="text-sm text-green-700">✓ {revokeState.success}</span>
          )}
          {revokeState?.error && (
            <span className="text-sm text-red-600">{revokeState.error}</span>
          )}
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
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">會員</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">來源</th>
                <th className="px-4 py-3">開通時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-4 py-6 text-center text-gray-400">
                    這堂課還沒有任何會員開通
                  </td>
                </tr>
              )}
              {members.map((m, i) => {
                const src = enrollmentSource(m.source, m.orderId);
                return (
                  <tr
                    key={m.userId}
                    className={selected.has(m.userId) ? "bg-indigo-50" : ""}
                  >
                    {canEdit && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          name="userIds"
                          value={m.userId}
                          checked={selected.has(m.userId)}
                          onChange={() => toggle(m.userId)}
                          aria-label={`選擇 ${m.email}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2">
                      {m.name ?? (
                        <span className="text-gray-300">（查無會員資料）</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{m.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${src.className}`}
                      >
                        {src.text}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {formatDate(m.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>
    </>
  );
}
