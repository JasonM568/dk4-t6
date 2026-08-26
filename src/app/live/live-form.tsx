"use client";

import { useActionState, useState } from "react";
import { liveLoginAction, type LiveLoginState } from "@/actions/live";

/** 4 位上課碼輸入表單（簡訊上的碼）。
 *  linkError = 從 /live/<碼> 一鍵連結進來但驗失敗的原因，先講清楚再讓他手動輸入 */
export function LiveLoginForm({ linkError }: { linkError?: string | null }) {
  const [state, action, pending] = useActionState<LiveLoginState, FormData>(
    liveLoginAction,
    null,
  );
  return (
    <form action={action} className="w-full max-w-xs space-y-4 text-center">
      <div className="text-4xl">🎥</div>
      <h1 className="text-xl font-bold">上課連結</h1>
      <p className="text-sm text-gray-500">
        輸入簡訊／通知信裡的 4 位上課碼，取得上課連結與課程資料
      </p>
      <input
        name="code"
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        required
        autoFocus
        autoComplete="off"
        placeholder="••••"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] focus:border-black focus:outline-none"
      />
      <button
        disabled={pending}
        className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "查詢中…" : "取得上課連結"}
      </button>
      {(state?.error || linkError) && (
        <p className="text-sm text-red-600">{state?.error ?? linkError}</p>
      )}
      <p className="pt-2 text-xs text-gray-400">
        找不到上課碼？請洽客服，或回覆您收到的上課通知簡訊。
      </p>
    </form>
  );
}

/** 一鍵複製（會議 ID／密碼手打容易錯，尤其長密碼） */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 舊瀏覽器／未授權剪貼簿：值本來就顯示在畫面上，讓使用者自己選取即可
          setCopied(false);
        }
      }}
      aria-label={`複製${label}`}
      className="rounded-lg border border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-50"
    >
      {copied ? "已複製" : "複製"}
    </button>
  );
}
