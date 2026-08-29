"use client";

import { useActionState } from "react";
import {
  completeProfileAction,
  type CompleteProfileState,
} from "@/actions/auth";
import { PrivacyNotice } from "@/components/privacy-notice";
import { PRIVACY_CONSENT_LABEL } from "@/lib/privacy";

export function CompleteProfileForm({
  next,
  defaultPhone,
  defaultName,
}: {
  next: string;
  defaultPhone: string;
  defaultName: string;
}) {
  const [state, formAction, pending] = useActionState<
    CompleteProfileState,
    FormData
  >(completeProfileAction, null);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <h1 className="mb-2 text-2xl font-bold">補齊會員資料</h1>
      <p className="mb-6 text-sm text-gray-600">
        為了提供上課通知與帳號服務，請{defaultPhone ? "確認手機號碼" : "補填手機號碼"}
        並同意個人資料蒐集告知事項，完成後即可繼續使用。
      </p>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="mb-1 block text-sm font-medium">姓名</label>
          <input
            name="name"
            required
            maxLength={50}
            placeholder="請填真實姓名"
            defaultValue={defaultName}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">用於訂單與電子發票的買受人資訊</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">手機號碼</label>
          <input
            name="phone"
            type="tel"
            required
            // tel 而非 numeric：海外門號要打得出 "+"，numeric 鍵盤上沒有這個鍵
            inputMode="tel"
            placeholder="0912345678"
            defaultValue={defaultPhone}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          />
          <p className="mt-1 text-xs text-gray-400">
            {defaultPhone
              ? "此號碼來自你先前報名課程時填寫的資料，可直接修改"
              : "09 開頭 10 碼，用於上課通知與帳號服務"}
          </p>
          {/* 海外會員在這頁最容易卡死（填不出台灣號碼就出不了閘門），
              提示必須無條件顯示，不能藏在 defaultPhone 的三元判斷裡 */}
          <p className="mt-1 text-xs text-gray-400">
            海外門號請加國碼，例如 +60123456789（上課通知會改以 Email 寄送）
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
