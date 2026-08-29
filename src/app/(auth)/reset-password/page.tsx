"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// 設定新密碼頁。唯一入口：/auth/confirm 已用 token_hash 驗過並建好 session 才會到這裡。
//
// 這頁刻意「不」自己吃 URL 上的 ?code= 或 #access_token 來建 session：
// 那等於讓任何人把外來 token 塞進受害者的瀏覽器（session fixation）——受害者以為在
// 改自己的密碼，實際改到攻擊者帳號、之後所有操作都在攻擊者帳號下。course 站的
// recovery 一律走 /auth/confirm（見 forgotPasswordAction 的 redirectTo），到這頁時
// session 已由 server 端 cookie 建好，直接讀 getSession 即可。
type PageStatus = "checking" | "ready" | "no-session";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<PageStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function ensureSession() {
      const { data } = await supabase.auth.getSession();
      setStatus(data.session ? "ready" : "no-session");
    }

    ensureSession();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    // 雙重驗證：長度 ≥6（對齊 hope 站規則）+ 兩次輸入一致
    if (password.length < 6) {
      setError("密碼至少 6 字元");
      return;
    }
    if (password !== confirm) {
      setError("兩次輸入的密碼不一致");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setPending(false);
      if (updateError.code === "same_password") {
        setError("新密碼不可與舊密碼相同");
      } else if (updateError.code === "weak_password") {
        setError("密碼強度不足，請至少使用 6 字元");
      } else {
        setError("密碼更新失敗，請重新從信件連結進入或再試一次");
      }
      return;
    }

    router.replace("/dashboard");
  }

  if (status === "checking") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <p className="text-center text-sm text-gray-500">驗證中…</p>
      </div>
    );
  }

  if (status === "no-session") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
        <h1 className="mb-6 text-2xl font-bold">重設密碼</h1>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          重設密碼連結已失效或未經驗證，請重新申請。
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          <Link
            href="/forgot-password"
            className="font-medium text-black underline"
          >
            重新申請重設密碼
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-bold">設定新密碼</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">新密碼</label>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">至少 6 字元</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">確認新密碼</label>
          <input
            name="confirm"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-black py-2.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "更新中…" : "更新密碼"}
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-gray-400">
        新密碼在希望學院（hope.huangxi.info）同步生效
      </p>
    </div>
  );
}
