"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type ActionState } from "@/actions/auth";

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    registerAction,
    {},
  );

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-bold">會員註冊</h1>
      <form action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">姓名</label>
          <input
            name="name"
            type="text"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
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
          <p className="mt-1 text-xs text-gray-400">至少 6 碼</p>
        </div>
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
          {pending ? "註冊中…" : "註冊並登入"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        已經有帳號？{" "}
        <Link href="/login" className="font-medium text-black underline">
          登入
        </Link>
      </p>
    </div>
  );
}
