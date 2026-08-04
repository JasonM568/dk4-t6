"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { boardLoginAction, type BoardLoginState } from "@/actions/board";

/** 4 位碼登入表單 */
export function BoardLoginForm() {
  const [state, action, pending] = useActionState<BoardLoginState, FormData>(
    boardLoginAction,
    null,
  );
  return (
    <form action={action} className="w-full max-w-xs space-y-4 text-center">
      <div className="text-4xl">📊</div>
      <h1 className="text-xl font-bold">課程報名看板</h1>
      <p className="text-sm text-gray-500">輸入 4 位登入碼查看近期課程報名情況</p>
      <input
        name="code"
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        required
        autoFocus
        placeholder="••••"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] focus:border-black focus:outline-none"
      />
      <button
        disabled={pending}
        className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "驗證中…" : "進入看板"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

/** 每 60 秒自動刷新（即時看板） */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
