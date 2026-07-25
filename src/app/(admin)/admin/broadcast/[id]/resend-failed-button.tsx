"use client";

import { useActionState } from "react";
import {
  resendFailedBroadcastAction,
  type BroadcastState,
} from "@/actions/admin";
import { SubmitButton } from "@/components/admin/submit-button";

/** 「補寄失敗者」按鈕＋結果訊息（放在群發明細頁的失敗名單區塊） */
export function ResendFailedButton({
  broadcastId,
  count,
}: {
  broadcastId: string;
  count: number;
}) {
  const [state, formAction] = useActionState<BroadcastState, FormData>(
    resendFailedBroadcastAction,
    null,
  );

  return (
    <div>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`確定補寄給 ${count} 位失敗的收件人嗎？`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="broadcastId" value={broadcastId} />
        <SubmitButton
          pendingText="補寄中…"
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          補寄失敗者（{count}）
        </SubmitButton>
      </form>
      {state?.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.success}
        </p>
      )}
    </div>
  );
}
