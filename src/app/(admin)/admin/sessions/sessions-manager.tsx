"use client";

import { useActionState } from "react";
import {
  createSessionAction,
  updateSessionAction,
  deleteSessionAction,
  addSignupAction,
  removeSignupAction,
  uploadOrdersAction,
  saveBoardCodeAction,
  type SessionFormState,
  type UploadState,
} from "@/actions/sessions";
import { formatDate } from "@/lib/format";

export type SignupRow = {
  id: string;
  orderNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  product: string | null;
  orderedAt: string | null;
};

export type SessionRow = {
  id: string;
  title: string;
  eventDate: string | null;
  keywords: string[];
  isVisible: boolean;
  signups: SignupRow[];
};

function Feedback({ state }: { state: SessionFormState }) {
  if (!state) return null;
  return state.error ? (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
  ) : state.success ? (
    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{state.success}</div>
  ) : null;
}

/** 看板設定：4 位碼＋登入時效 */
export function BoardCodeForm({
  current,
  currentHours,
}: {
  current: string | null;
  currentHours: number;
}) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    saveBoardCodeAction,
    null,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-gray-500">
          看板登入碼（4 位數字）{current ? `｜目前：${current}` : "｜尚未設定，看板無法登入"}
        </label>
        <input
          name="code"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          defaultValue={current ?? ""}
          placeholder="例：2688"
          className="w-32 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">
          登入時效（小時，逾時自動登出）
        </label>
        <input
          name="hours"
          type="number"
          min={1}
          max={720}
          defaultValue={currentHours}
          className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
      </div>
      <button
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "儲存中…" : "儲存設定"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** 上傳訂單檔 */
export function UploadOrdersForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(
    uploadOrdersAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          required
          className="text-sm"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "匯入中，請勿關閉頁面…" : "上傳並歸類"}
        </button>
      </div>
      {state?.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
      )}
      {state?.report && (
        <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <div className="font-medium">
            匯入完成：新增 {state.report.imported}、已在名單 {state.report.duplicate}、
            未付款略過 {state.report.unpaid}、取消/退款移除 {state.report.canceledRemoved}
            {state.report.invalid > 0 && `、資料不全 ${state.report.invalid}`}
            （檔案共 {state.report.totalRows} 列）
          </div>
          {state.report.unmatched.length > 0 && (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <div className="font-medium">
                ⚠️ {state.report.unmatched.length} 種產品對不到場次（未匯入）——請到下方場次補關鍵字後重新上傳同一檔案：
              </div>
              <ul className="mt-1 list-inside list-disc">
                {state.report.unmatched.map((u) => (
                  <li key={u.product}>
                    {u.product}（{u.count} 筆）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

/** 新增場次 */
export function CreateSessionForm() {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    createSessionAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          name="title"
          required
          placeholder="場次名稱（例：8/20 AI初階 台北場）"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <input
          type="date"
          name="eventDate"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" name="isVisible" defaultChecked /> 顯示於看板
        </label>
      </div>
      <input
        name="keywords"
        required
        placeholder="產品關鍵字（逗號分隔，訂單「產品」欄含任一關鍵字即歸入，例：8/20, AI初階台北）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "建立中…" : "建立場次"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** 手動新增報名（電話/現金/特殊訂單） */
function AddSignupForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    addSignupAction.bind(null, sessionId),
    null,
  );
  return (
    <form action={action} className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3">
      <div className="text-xs font-medium text-gray-500">
        手動新增報名（電話報名、現金付款、特殊訂單等不經訂單檔的情況）
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          placeholder="姓名（必填）"
          className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="orderNo"
          placeholder="訂單編號（選填，留空自動編）"
          className="w-52 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="note"
          placeholder="備註（選填，例：現金付款）"
          className="w-52 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "加入中…" : "加入名單"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** 場次卡片：報名名單 + 編輯 + 刪除 */
export function SessionCard({ session, canEdit }: { session: SessionRow; canEdit: boolean }) {
  const [editState, editAction, editing] = useActionState<SessionFormState, FormData>(
    updateSessionAction.bind(null, session.id),
    null,
  );
  // 舊生 = 報名複訓方案（產品名含「複訓」）；與 /board 同一判別規則
  const retrainCount = session.signups.filter((s) => s.product?.includes("複訓")).length;
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-medium">{session.title}</span>
        {session.eventDate && (
          <span className="text-sm text-gray-400">{formatDate(session.eventDate)}</span>
        )}
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-bold">
          {session.signups.length} 人
        </span>
        <span className="text-xs text-gray-400">
          新生 {session.signups.length - retrainCount}｜舊生 {retrainCount}
        </span>
        {!session.isVisible && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
            不顯示於看板
          </span>
        )}
      </summary>
      <div className="space-y-4 border-t border-gray-100 px-4 py-3">
        {canEdit && (
          <form action={editAction} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap gap-2">
              <input
                name="title"
                defaultValue={session.title}
                required
                className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
              />
              <input
                type="date"
                name="eventDate"
                defaultValue={session.eventDate ? session.eventDate.slice(0, 10) : ""}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" name="isVisible" defaultChecked={session.isVisible} />
                顯示於看板
              </label>
            </div>
            <input
              name="keywords"
              defaultValue={session.keywords.join(", ")}
              required
              placeholder="產品關鍵字（逗號分隔）"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={editing}
                className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
              >
                {editing ? "儲存中…" : "儲存修改"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `確定刪除場次「${session.title}」？\n${session.signups.length} 筆報名紀錄會一併刪除。`,
                    )
                  )
                    deleteSessionAction(session.id);
                }}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
              >
                刪除場次
              </button>
              <Feedback state={editState} />
            </div>
          </form>
        )}

        {canEdit && <AddSignupForm sessionId={session.id} />}

        {session.signups.length === 0 ? (
          <p className="text-sm text-gray-400">還沒有報名資料——上傳訂單檔後自動歸入，或用上方手動新增</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">姓名</th>
                <th className="px-2 py-1.5">訂單編號</th>
                <th className="px-2 py-1.5">產品</th>
                <th className="px-2 py-1.5">訂單日期</th>
                {canEdit && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {session.signups.map((s, i) => (
                <tr key={s.id}>
                  <td className="px-2 py-1.5 font-mono text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5">{s.name}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{s.orderNo}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{s.product ?? "—"}</td>
                  <td className="px-2 py-1.5 text-gray-400">
                    {s.orderedAt ? formatDate(s.orderedAt) : "—"}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`移除 ${s.name}（${s.orderNo}）的報名紀錄？`))
                            removeSignupAction(s.id);
                        }}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
                      >
                        移除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
