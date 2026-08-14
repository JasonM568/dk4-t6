"use client";

import { useActionState } from "react";
import { refreshSmsDeliveryAction, type SmsState } from "@/actions/sms";

/** 手動更新送達狀態：查詢結果要看得到（查了幾筆、更新幾筆），
 *  不然按下去畫面沒變時，會分不清是「沒有新狀態」還是「壞掉了」。 */
export function RefreshDeliveryButton({ broadcastId }: { broadcastId: string }) {
  const [state, action, pending] = useActionState<SmsState, FormData>(
    () => refreshSmsDeliveryAction(broadcastId),
    null,
  );
  return (
    <form action={action} className="ml-auto flex items-center gap-2">
      {state?.success && <span className="text-xs text-gray-500">{state.success}</span>}
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      <button
        disabled={pending}
        className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
      >
        {pending ? "查詢中…" : "更新送達狀態"}
      </button>
    </form>
  );
}
