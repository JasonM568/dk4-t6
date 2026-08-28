"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import {
  importStudentHistoryFromOrders,
  syncSessionHistoriesAction,
  type OrderHistoryImportState,
} from "@/actions/student-history";
import { SubmitButton } from "@/components/admin/submit-button";

function Report({ s }: { s: OrderHistoryImportState }) {
  if (!s) return null;
  if (s.error) return <p className="mt-2 text-sm text-red-600">{s.error}</p>;
  if (!s.success) return null;
  return (
    <p className="mt-2 text-sm text-green-700">
      ✓ {s.success}：{s.students} 位學員、新增 {s.histories} 筆紀錄
      {s.duplicates ? <span className="text-gray-500">（{s.duplicates} 筆已存在略過）</span> : null}
      {s.noContact ? (
        <span className="ml-1 text-amber-600">（{s.noContact} 筆沒有電話/信箱認不出人，未建卡）</span>
      ) : null}
    </p>
  );
}

/** 上課紀錄的兩條省力匯入路徑：1shop 訂單檔直接匯（免轉範本）＋場次名單一鍵同步。
 *  兩條都防重複（訂單編號／場次 id 當鍵），重按重傳不會灌爆記錄卡。 */
export function StudentSync() {
  const [orderState, orderAction] = useActionState<OrderHistoryImportState, FormData>(
    importStudentHistoryFromOrders,
    null,
  );
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [syncState, setSyncState] = useState<OrderHistoryImportState>(null);
  const [syncing, startSync] = useTransition();

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {/* 1shop 訂單檔直接匯入 */}
      <form action={orderAction} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
        <h2 className="font-bold text-indigo-900">📦 1shop 訂單檔匯入</h2>
        <p className="mb-2 mt-1 text-xs text-indigo-800/70">
          整份訂單匯出檔（可以是全期間）直接丟進來：已付款的每筆訂單寫成一筆上課紀錄，
          課程名＝產品欄原文；同行者有留電話的也各自建卡。重傳同一份檔不會重複。
        </p>
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition ${
            picked
              ? "border-indigo-400 bg-white"
              : "border-indigo-300 bg-white/60 hover:border-indigo-500 hover:bg-white"
          }`}
        >
          <span className="text-2xl">📄</span>
          <span className="min-w-0 flex-1">
            {picked ? (
              <>
                <span className="block truncate text-sm font-medium text-indigo-900">{picked.name}</span>
                <span className="block text-xs text-indigo-500">
                  {(picked.size / 1024).toFixed(0)} KB · 點擊可重新選擇
                </span>
              </>
            ) : (
              <>
                <span className="block text-sm font-medium text-gray-700">點擊這裡選擇訂單檔</span>
                <span className="block text-xs text-gray-400">1shop 匯出的 .xlsx 或 .csv</span>
              </>
            )}
          </span>
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
        <div className="mt-2">
          <SubmitButton
            pendingText="匯入中，請勿關閉頁面…"
            disabled={!picked}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            匯入上課紀錄
          </SubmitButton>
        </div>
        <Report s={orderState} />
      </form>

      {/* 場次名單同步 */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h2 className="font-bold text-emerald-900">🔄 場次名單同步</h2>
        <p className="mb-2 mt-1 text-xs text-emerald-800/70">
          把場次看板裡<strong>已結束場次</strong>的報名名單（不含工作人員與延期出去的人）
          寫進上課紀錄，課程名＝場次名稱。按幾次都不會重複，之後每檔課結束後按一下即可。
        </p>
        <button
          type="button"
          disabled={syncing}
          onClick={() =>
            startSync(async () => setSyncState(await syncSessionHistoriesAction()))
          }
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {syncing ? "同步中…" : "同步已結束場次的名單"}
        </button>
        <Report s={syncState} />
      </div>
    </div>
  );
}
