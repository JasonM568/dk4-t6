"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCheckout } from "@/actions/checkout";

type Props = {
  courseId: string;
  isLoggedIn: boolean;
  isEnrolled: boolean;
};

export function BuyButton({ courseId, isLoggedIn, isEnrolled }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isEnrolled) {
    return (
      <a
        href="/my-courses"
        className="block w-full rounded-lg bg-green-600 py-3 text-center font-medium text-white transition hover:bg-green-700"
      >
        前往觀看 →
      </a>
    );
  }

  function handleBuy() {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
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
      // 動態建立表單並送出到 ECPay 收銀台
      const form = document.createElement("form");
      form.method = "POST";
      form.action = res.action;
      for (const [key, value] of Object.entries(res.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    });
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleBuy}
        disabled={pending}
        className="w-full rounded-lg bg-black py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "前往付款中…" : isLoggedIn ? "立即購買" : "登入後購買"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
