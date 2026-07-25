"use client";

import { Suspense, useActionState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { registerAction, type ActionState } from "@/actions/auth";

/** 註冊完成轉換事件（GA4 sign_up / Meta Pixel CompleteRegistration / GTM dataLayer）。
 *  只在成功畫面掛載時觸發一次；追蹤碼未啟用時 window.gtag/fbq 為 undefined，安全略過。
 *  註：Confirm email 關閉時走 server redirect("/dashboard")，該路徑不埋（正式環境 Confirm 開啟，不會走到） */
function TrackSignUpOnce() {
  useEffect(() => {
    window.gtag?.("event", "sign_up", { method: "email" });
    window.fbq?.("track", "CompleteRegistration");
    window.dataLayer?.push({ event: "sign_up" });
  }, []);
  return null;
}

export default function RegisterPage() {
  // useSearchParams 需要 Suspense 邊界（讀取 ?invite= 邀請碼）
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    registerAction,
    {},
  );
  const invite = useSearchParams().get("invite") ?? "";

  // Confirm email 開啟時：註冊成功改顯示「請收確認信」，不自動登入
  if (state.success && state.message) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <TrackSignUpOnce />
        <h1 className="mb-6 text-2xl font-bold">會員註冊</h1>
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.message}
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          完成驗證後即可{" "}
          <Link href="/login" className="font-medium text-black underline">
            登入
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-bold">會員註冊</h1>
      {invite && (
        <p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
          🎟 你正在使用專屬邀請連結註冊，完成後將自動加入對應專區。
        </p>
      )}
      <form action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">姓名</label>
          <input
            name="displayName"
            type="text"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">至少 2 個字，中英文皆可</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">密碼</label>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">至少 6 字元</p>
        </div>
        {invite && (
          <div>
            <label className="mb-1 block text-sm font-medium">專區邀請碼</label>
            {/* 防呆：連結帶入的邀請碼鎖定唯讀——曾有學員誤改/清空欄位，註冊後進不了專區 */}
            <input
              name="invite"
              type="text"
              value={invite.trim().toUpperCase()}
              readOnly
              tabIndex={-1}
              className="w-full cursor-default rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono uppercase tracking-widest text-gray-600 outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              🔒 邀請碼已由連結自動帶入並鎖定，直接完成註冊即可
            </p>
          </div>
        )}
        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-black py-2.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "註冊中…" : "註冊"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        已經有帳號？{" "}
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
