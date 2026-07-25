"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  removeGroupMember,
  updateGroupMemberAction,
  type GroupMemberEditState,
} from "@/actions/admin";
import { SubmitButton } from "@/components/admin/submit-button";

type Member = {
  id: string;
  email: string;
  name: string | null;
  joinedAt: string;
};

/** 名單列表：可搜尋（email / 姓名）、原地編輯、移除 */
export function MembersTable({
  groupId,
  members,
}: {
  groupId: string;
  members: Member[];
}) {
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const keyword = q.trim().toLowerCase();
  const rows = members
    .map((m, i) => ({ ...m, no: i + 1 }))
    .filter(
      (m) =>
        !keyword ||
        m.email.toLowerCase().includes(keyword) ||
        (m.name ?? "").toLowerCase().includes(keyword),
    );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋 email 或姓名…"
          className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        {keyword && (
          <span className="text-sm text-gray-500">符合 {rows.length} 筆</span>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">姓名</th>
            <th className="px-4 py-3">加入時間</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {members.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-4 text-gray-400">
                尚無名單，在上方貼入
              </td>
            </tr>
          )}
          {members.length > 0 && rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-4 text-gray-400">
                沒有符合「{q.trim()}」的名單
              </td>
            </tr>
          )}
          {rows.map((m) =>
            editingId === m.id ? (
              <EditRow
                key={m.id}
                member={m}
                groupId={groupId}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono text-gray-400">{m.no}</td>
                <td className="px-4 py-2">{m.email}</td>
                <td className="px-4 py-2">{m.name ?? "—"}</td>
                <td className="px-4 py-2 text-gray-400">{m.joinedAt}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setEditingId(m.id)}
                    className="mr-3 text-sm text-indigo-600 hover:underline"
                  >
                    編輯
                  </button>
                  <form
                    action={removeGroupMember.bind(null, m.id, groupId)}
                    className="inline"
                  >
                    <SubmitButton
                      pendingText="移除中…"
                      className="text-sm text-red-600 hover:underline"
                    >
                      移除
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({
  member,
  groupId,
  onClose,
}: {
  member: Member & { no: number };
  groupId: string;
  onClose: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState<
    GroupMemberEditState,
    FormData
  >(updateGroupMemberAction.bind(null, member.id, groupId), null);

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  return (
    <tr className="bg-indigo-50/40">
      <td className="px-4 py-2 font-mono text-gray-400">{member.no}</td>
      <td className="px-4 py-2">
        <form id={formId} action={formAction} />
        <input
          form={formId}
          name="email"
          required
          defaultValue={member.email}
          className="w-full rounded-lg border border-gray-300 px-2 py-1 font-mono text-sm focus:border-black focus:outline-none"
        />
        {state?.error && (
          <p className="mt-1 text-xs text-red-600">{state.error}</p>
        )}
      </td>
      <td className="px-4 py-2">
        <input
          form={formId}
          name="name"
          defaultValue={member.name ?? ""}
          placeholder="姓名（可空）"
          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
        />
      </td>
      <td className="px-4 py-2 text-gray-400">{member.joinedAt}</td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button
          form={formId}
          type="submit"
          disabled={pending}
          className="mr-3 text-sm font-medium text-indigo-600 hover:underline disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 hover:underline"
        >
          取消
        </button>
      </td>
    </tr>
  );
}
