"use client";

import { useActionState } from "react";
import { assignStaffRoleAction, type StaffAssignState } from "@/actions/admin";

export function AssignStaffForm() {
  const [state, formAction, pending] = useActionState<StaffAssignState, FormData>(
    assignStaffRoleAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4"
    >
      <div className="font-medium">＋ 指派幹部角色</div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">會員 Email</label>
          <input
            name="email"
            required
            placeholder="須為平台會員的 email"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">角色</label>
          <select
            name="role"
            defaultValue="OPERATOR"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="OPERATOR">操作人員（可查看+編輯+匯出+批次/群發）</option>
            <option value="COACH">總教練（只能查看訂單/課程/會員）</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "指派中…" : "指派"}
        </button>
      </div>
      {state?.success && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ {state.success}
        </div>
      )}
      {state?.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </form>
  );
}
