"use client";

import { useActionState } from "react";
import type { RedeemState } from "@/actions/zone";

/** 擋牆頁：已登入的非會員輸入邀請碼取得會籍 */
export function RedeemInviteForm({
  redeemAction,
  buttonColor,
}: {
  redeemAction: (prev: RedeemState, formData: FormData) => Promise<RedeemState>;
  buttonColor?: string; // 專區主題色（未提供時用黑色）
}) {
  const [state, formAction, pending] = useActionState<RedeemState, FormData>(
    redeemAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-2">
        <input
          name="code"
          required
          placeholder="輸入邀請碼（8 碼）"
          maxLength={16}
          className="w-48 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:border-black focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${buttonColor ? "hover:opacity-90" : "bg-black hover:bg-gray-800"}`}
          style={buttonColor ? { backgroundColor: buttonColor } : undefined}
        >
          {pending ? "驗證中…" : "加入專區"}
        </button>
      </div>
      {state?.success && (
        <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          ✓ {state.success}，頁面即將重新整理…
        </div>
      )}
      {state?.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </form>
  );
}
