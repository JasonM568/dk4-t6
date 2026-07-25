"use client";

import { useActionState } from "react";
import {
  saveTrackingSettingsAction,
  type BroadcastState,
} from "@/actions/admin";
import { SubmitButton } from "@/components/admin/submit-button";

/** 追蹤碼設定表單（GA4 / Meta Pixel / GTM）；格式驗證在 server action */
export function TrackingForm({
  defaults,
}: {
  defaults: { ga4: string; metaPixel: string; gtm: string };
}) {
  const [state, formAction] = useActionState<BroadcastState, FormData>(
    saveTrackingSettingsAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-gray-200 p-4"
    >
      <div>
        <label className="mb-1 block text-sm font-medium">
          GA4 評估 ID（Google Analytics）
        </label>
        <input
          name="ga4"
          defaultValue={defaults.ga4}
          placeholder="G-XXXXXXXXXX"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">
          Meta Pixel ID（FB/IG 廣告）
        </label>
        <input
          name="metaPixel"
          defaultValue={defaults.metaPixel}
          placeholder="1234567890123456"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">
          GTM 容器 ID（Google Tag Manager）
        </label>
        <input
          name="gtm"
          defaultValue={defaults.gtm}
          placeholder="GTM-XXXXXXX"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          GA4/Pixel 可直接填上方欄位，不必透過 GTM；三者可並存，但同一追蹤碼別重複安裝
          （例如 GTM 裡已裝 GA4 就別再填 GA4 欄位）。
        </p>
      </div>
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ {state.success}
        </p>
      )}
      <SubmitButton
        pendingText="儲存中…"
        className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        儲存追蹤碼設定
      </SubmitButton>
    </form>
  );
}
