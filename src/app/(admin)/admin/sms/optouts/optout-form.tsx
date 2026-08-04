"use client";

import { useActionState } from "react";
import { addSmsOptOutAction, type SmsState } from "@/actions/sms";
import { SubmitButton } from "@/components/admin/submit-button";

/** 手動把號碼加進退訂名單：客服代退，或回報空號／停用 */
export function OptOutForm() {
  const [state, action] = useActionState<SmsState, FormData>(addSmsOptOutAction, null);

  return (
    <form
      action={action}
      className="rounded-xl border border-dashed border-gray-300 p-4"
    >
      <div className="mb-2 text-sm font-medium">加入退訂名單</div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">手機</label>
          <input
            name="mobile"
            required
            inputMode="numeric"
            placeholder="09xxxxxxxx"
            className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">來源</label>
          <select
            name="source"
            defaultValue="MANUAL"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="MANUAL">客服代退（只擋行銷）</option>
            <option value="INVALID">無法送達／空號（連提醒也擋）</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-gray-500">原因（選填）</label>
          <input
            name="reason"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <SubmitButton
          pendingText="加入中…"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          加入
        </SubmitButton>
      </div>
      {state?.success && (
        <p className="mt-2 text-sm text-green-700">✓ {state.success}</p>
      )}
      {state?.error && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
