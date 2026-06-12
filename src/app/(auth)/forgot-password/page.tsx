"use client";

import { Suspense, useEffect, useState } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "@/actions/auth";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  // /auth/confirm 驗證失敗會帶 ?error=invalid_or_expired 導回本頁
  const linkExpired = searchParams.get("error") === "invalid_or_expired";

  const [state, formAction, pending] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordAction, {});

  // 倒數鎖鈕：寄出成功鎖 60 秒；429 時改用伺服器建議的 Retry-After 秒數。
  // 倒數終點由 action 回傳的時間戳推導，每秒 tick 一次重新計算剩餘秒數
  const lockUntil =
    state.sentAt && state.retryAfter
      ? state.sentAt + state.retryAfter * 1000
      : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lockUntil || lockUntil <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  const countdown = Math.max(0, Math.ceil((lockUntil - now) / 1000));

  const locked = pending || countdown > 0;

  // 已寄出狀態：顯示提示 + 重寄按鈕（同一表單再送一次即重寄）
  if (state.success) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <h1 className="mb-6 text-2xl font-bold">忘記密碼</h1>
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          若該 Email 已註冊，重設密碼信已寄出，請至信箱收信並點擊信中連結。
        </p>
        <p className="mt-3 text-sm text-gray-600">
          沒收到信？請先檢查垃圾信件匣，或稍候再重新寄送。
        </p>
        <form action={formAction} className="mt-4">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <button
            type="submit"
            disabled={locked}
            className="w-full rounded-lg bg-black py-2.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {pending
              ? "寄送中…"
              : countdown > 0
                ? `重新寄送（${countdown} 秒後可用）`
                : "重新寄送"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          <Link href="/login" className="font-medium text-black underline">
            返回登入
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-bold">忘記密碼</h1>
      {linkExpired && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          重設密碼連結已失效或已使用，請重新申請。
        </p>
      )}
      <p className="mb-4 text-sm text-gray-600">
        輸入你註冊時使用的 Email，我們會寄送重設密碼連結給你。
      </p>
      <form action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
        </div>
        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
            {countdown > 0 && `（${countdown} 秒）`}
          </p>
        )}
        <button
          type="submit"
          disabled={locked}
          className="w-full rounded-lg bg-black py-2.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending
            ? "寄送中…"
            : countdown > 0
              ? `請稍候（${countdown} 秒）`
              : "寄送重設密碼信"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        想起密碼了？{" "}
        <Link href="/login" className="font-medium text-black underline">
          登入
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-gray-400">
        帳號與希望學院（hope.huangxi.info）通用
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  // useSearchParams 需要 Suspense 邊界
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
