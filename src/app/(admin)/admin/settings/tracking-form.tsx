"use client";

import { useActionState, useState } from "react";
import {
  saveTrackingSettingsAction,
  type TrackingState,
} from "@/actions/admin";
import type { TrackingField } from "@/lib/tracking-id";
import { SubmitButton } from "@/components/admin/submit-button";

type Values = Record<TrackingField, string>;

const FIELDS: {
  key: TrackingField;
  label: string;
  placeholder: string;
}[] = [
  { key: "ga4", label: "GA4 評估 ID（Google Analytics）", placeholder: "G-XXXXXXXXXX" },
  { key: "metaPixel", label: "Meta Pixel ID（FB/IG 廣告）", placeholder: "1234567890123456" },
  { key: "gtm", label: "GTM 容器 ID（Google Tag Manager）", placeholder: "GTM-XXXXXXX" },
];

/** 追蹤碼設定表單（GA4 / Meta Pixel / GTM）；格式驗證在 server action。
 *  欄位一律受控：React 19 在 action 結束後會重置未受控欄位——格式錯被退回時，
 *  使用者剛貼的代碼會「按了儲存就消失」，連錯在哪都看不到（2026-09-30 回報）。 */
export function TrackingForm({ defaults }: { defaults: Values }) {
  const [state, formAction] = useActionState<TrackingState, FormData>(
    saveTrackingSettingsAction,
    null,
  );
  const [values, setValues] = useState<Values>(defaults);

  // 存檔成功時換成實際存進去的值（貼整段安裝碼時會被抽成純 ID）
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.saved) setValues(state.saved);
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-gray-200 p-4"
    >
      {FIELDS.map((f) => {
        const hasError = state?.field === f.key;
        return (
          <div key={f.key}>
            <label className="mb-1 block text-sm font-medium">{f.label}</label>
            <input
              name={f.key}
              value={values[f.key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
              placeholder={f.placeholder}
              className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${
                hasError
                  ? "border-red-500 focus:border-red-600"
                  : "border-gray-300 focus:border-black"
              }`}
            />
            {hasError && (
              <p className="mt-1 text-sm text-red-700">
                ✗ {state.error}（未儲存，三格都沒有變更）
              </p>
            )}
          </div>
        );
      })}
      <p className="-mt-2 text-xs text-gray-400">
        可只填 ID，也可直接貼整段安裝碼，系統會自動抽出 ID。
        GA4/Pixel 可直接填上方欄位，不必透過 GTM；三者可並存，但同一追蹤碼別重複安裝
        （例如 GTM 裡已裝 GA4 就別再填 GA4 欄位）。
      </p>
      {state?.error && !state.field && (
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
