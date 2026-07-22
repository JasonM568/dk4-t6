"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { registerAction, type ActionState } from "@/actions/auth";

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
            <input
              name="invite"
              type="text"
              defaultValue={invite}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono uppercase tracking-widest outline-none focus:border-black"
            />
            <p className="mt-1 text-xs text-gray-400">
              邀請連結已自動帶入，無需修改
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
