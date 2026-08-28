"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  uploadFinanceOnlyAction,
  type FinanceFormState,
} from "@/actions/session-finance";
import { SubmitButton } from "@/components/admin/submit-button";

/** 金額補匯（不動名單）：收支總覽頁的上傳入口。
 *  歷史場次補資料／同場修正金額用；日常上傳走場次看板（名單＋金額一次寫）。 */
export function FinanceUploadForm() {
  const [uploadState, uploadAction] = useActionState<FinanceFormState, FormData>(
    uploadFinanceOnlyAction,
    null,
  );
  // 原生 file input 長得跟一般文字一樣，改成明顯的點擊區塊＋選檔後回饋（同場次看板上傳）
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  return (
    <form
      action={uploadAction}
      className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h2 className="font-bold text-amber-900">📥 金額補匯（不動名單）</h2>
      <p className="text-xs text-amber-800/80">
        上傳 1shop 訂單檔，只寫入收支金額、完全不動報名名單——歷史場次要開始算收支、
        或匯過名單但當時還沒有收支模組時用。人工調整過與已結算的訂單不會被覆蓋。
        平常在場次看板上傳訂單檔時金額會自動一起寫，不需要這步。
      </p>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition ${
          picked
            ? "border-amber-400 bg-white"
            : "border-amber-300 bg-white/60 hover:border-amber-500 hover:bg-white"
        }`}
      >
        <span className="text-2xl">📄</span>
        <span className="min-w-0 flex-1">
          {picked ? (
            <>
              <span className="block truncate text-sm font-medium text-amber-900">
                {picked.name}
              </span>
              <span className="block text-xs text-amber-600">
                {(picked.size / 1024).toFixed(0)} KB · 點擊可重新選擇
              </span>
            </>
          ) : (
            <>
              <span className="block text-sm font-medium text-gray-700">
                點擊這裡選擇訂單檔
              </span>
              <span className="block text-xs text-gray-400">
                1shop 匯出的 .xlsx 或 .csv
              </span>
            </>
          )}
        </span>
        {!picked && (
          <span className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800">
            選擇檔案
          </span>
        )}
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          required
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPicked(f ? { name: f.name, size: f.size } : null);
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton
          pendingText="匯入中，請勿關閉頁面…"
          disabled={!picked}
          className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          📥 補匯金額
        </SubmitButton>
        {!picked && <span className="text-xs text-amber-700/70">請先選擇訂單檔</span>}
      </div>
      {uploadState?.success && (
        <p className="text-sm text-green-700">✓ {uploadState.success}</p>
      )}
      {uploadState?.error && <p className="text-sm text-red-600">{uploadState.error}</p>}
    </form>
  );
}
