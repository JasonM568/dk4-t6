"use client";

import { useActionState, useState } from "react";
import {
  saveBuyersToMailGroupAction,
  type OrderActionState,
} from "@/actions/orders";
import { SubmitButton } from "@/components/admin/submit-button";

/** 把已付款買家拋進名單群組（EDM 群發用）。
 *  重複執行安全：同群組同 email 不會加兩次，可定期按來累積新買家。 */
export function SaveBuyersForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<OrderActionState, FormData>(
    saveBuyersToMailGroupAction,
    null,
  );

  return (
    <div className="text-sm">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-indigo-400 px-3 py-1.5 text-indigo-700 transition hover:bg-indigo-50"
        >
          📇 已付款買家 → 名單群組
        </button>
      ) : (
        <form
          action={formAction}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3"
        >
          <input
            name="groupName"
            required
            placeholder="群組名稱（例：平台購課會員）"
            className="rounded-lg border border-gray-300 px-3 py-1.5 focus:border-black focus:outline-none"
          />
          <select
            name="days"
            defaultValue="0"
            className="rounded-lg border border-gray-300 px-2 py-1.5"
          >
            <option value="0">全部期間</option>
            <option value="30">近 30 天付款</option>
            <option value="90">近 90 天付款</option>
            <option value="365">近一年付款</option>
          </select>
          <SubmitButton className="rounded-lg bg-black px-3 py-1.5 text-white hover:bg-gray-800">
            存入名單
          </SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-500 underline underline-offset-2"
          >
            關閉
          </button>
          {state?.error && <span className="w-full text-red-600">{state.error}</span>}
          {state?.success && <span className="w-full text-green-700">{state.success}</span>}
        </form>
      )}
    </div>
  );
}
