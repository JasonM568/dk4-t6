"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCheckout, createGuestCheckout } from "@/actions/checkout";

type Props = {
  courseId: string;
  courseSlug: string;
  isLoggedIn: boolean;
  isEnrolled: boolean;
};

const INPUT =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none";

/** 把金流回傳的欄位組成表單並 auto-submit 到收銀台 */
function postToGateway(action: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function BuyButton({
  courseId,
  courseSlug,
  isLoggedIn,
  isEnrolled,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 訪客購買：展開填資料表單（不強制先註冊，付款成功後自動開帳號）
  const [guestOpen, setGuestOpen] = useState(false);
  const [guest, setGuest] = useState({ email: "", name: "", phone: "" });

  // 有觀看權限 → 直接進播放頁觀看影片
  if (isEnrolled) {
    return (
      <a
        href={`/learn/${courseSlug}`}
        className="block w-full rounded-lg bg-green-600 py-3 text-center font-medium text-white transition hover:bg-green-700"
      >
        觀看影片 →
      </a>
    );
  }

  function handleMemberBuy() {
    setError(null);
    startTransition(async () => {
      const res = await createCheckout(courseId);
      if (!res.ok) {
        if (res.redirect) {
          router.push(res.redirect);
          return;
        }
        setError(res.error);
        return;
      }
      postToGateway(res.action, res.fields);
    });
  }

  function handleGuestBuy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createGuestCheckout(courseId, guest);
      if (!res.ok) {
        setError(res.error);
        if (res.redirect) router.push(res.redirect);
        return;
      }
      postToGateway(res.action, res.fields);
    });
  }

  // 會員：直接購買
  if (isLoggedIn) {
    return (
      <div className="space-y-2">
        <button
          onClick={handleMemberBuy}
          disabled={pending}
          className="w-full rounded-lg bg-black py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "前往付款中…" : "購買課程"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // 訪客：免註冊直接買，付款完成自動開通帳號
  if (!guestOpen) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setGuestOpen(true)}
          className="w-full rounded-lg bg-black py-3 font-medium text-white transition hover:bg-gray-800"
        >
          購買課程
        </button>
        <p className="text-center text-xs text-gray-500">
          免註冊即可購買，付款完成自動幫你開通帳號
        </p>
        <button
          onClick={() => router.push("/login")}
          className="w-full text-center text-xs text-gray-500 underline underline-offset-2"
        >
          已經是會員？登入後購買
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleGuestBuy} className="space-y-2.5">
      <p className="text-xs text-gray-500">
        填寫以下資料即可購買，付款完成後我們會用這個信箱幫你開通帳號與課程。
      </p>
      <label className="block">
        <span className="mb-1 block text-xs text-gray-600">
          Email <span className="text-red-600">*</span>
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={guest.email}
          onChange={(e) => setGuest((g) => ({ ...g, email: e.target.value }))}
          placeholder="開通通知與發票會寄到這裡"
          className={INPUT}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-gray-600">
          姓名 <span className="text-red-600">*</span>
        </span>
        <input
          required
          autoComplete="name"
          value={guest.name}
          onChange={(e) => setGuest((g) => ({ ...g, name: e.target.value }))}
          className={INPUT}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-gray-600">
          手機 <span className="text-red-600">*</span>
        </span>
        <input
          required
          inputMode="tel"
          autoComplete="tel"
          value={guest.phone}
          onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))}
          placeholder="09xxxxxxxx"
          className={INPUT}
        />
      </label>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      <button
        disabled={pending}
        className="w-full rounded-lg bg-black py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "前往付款中…" : "前往付款"}
      </button>
      <button
        type="button"
        onClick={() => router.push("/login")}
        className="w-full text-center text-xs text-gray-500 underline underline-offset-2"
      >
        已經是會員？登入後購買
      </button>
    </form>
  );
}
