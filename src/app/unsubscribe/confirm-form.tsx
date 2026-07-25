"use client";

import { useActionState } from "react";
import { unsubscribeAction, type ActionState } from "@/actions/auth";
import { SubmitButton } from "@/components/admin/submit-button";

export function UnsubscribeConfirmForm({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    unsubscribeAction,
    {},
  );

  return (
    <form action={formAction} className="mt-6 space-y-4 text-left">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          退訂原因（選填）
        </label>
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="告訴我們原因，幫助我們改進"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
        />
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <SubmitButton
        pendingText="處理中…"
        className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black"
      >
        確認退訂
      </SubmitButton>
    </form>
  );
}
