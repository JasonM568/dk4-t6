"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import {
  completeProfileAction,
  type CompleteProfileState,
} from "@/actions/auth";
import { PrivacyNotice } from "@/components/privacy-notice";
import { PRIVACY_CONSENT_LABEL } from "@/lib/privacy";

export default function CompleteProfilePage() {
  // useSearchParams 需要 Suspense 邊界（讀取 ?next= 原目的地）
  return (
    <Suspense>
      <CompleteProfileForm />
    </Suspense>
  );
}

function CompleteProfileForm() {
  const [state, formAction, pending] = useActionState<
    CompleteProfileState,
    FormData
  >(completeProfileAction, null);
  const next = useSearchParams().get("next") ?? "";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-2 text-2xl font-bold">補齊會員資料</h1>
      <p className="mb-6 text-sm text-gray-600">
        為了提供上課通知與帳號服務，請補填手機號碼並同意個人資料蒐集告知事項，
        完成後即可繼續使用。
      </p>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="mb-1 block text-sm font-medium">手機號碼</label>
          <input
            name="phone"
            type="tel"
            required
            inputMode="numeric"
            placeholder="0912345678"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">
            09 開頭 10 碼，用於上課通知與帳號服務
          </p>
        </div>
        <div className="space-y-2">
          <PrivacyNotice defaultOpen />
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input
              name="privacyConsent"
              type="checkbox"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
            />
            <span>{PRIVACY_CONSENT_LABEL}</span>
          </label>
        </div>
        {state?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-black py-2.5 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "儲存中…" : "完成補填"}
        </button>
      </form>
    </div>
  );
}
