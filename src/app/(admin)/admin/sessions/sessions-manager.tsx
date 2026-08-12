"use client";

import { useActionState, useRef, useState } from "react";
import {
  createSessionAction,
  updateSessionAction,
  deleteSessionAction,
  addSignupAction,
  removeSignupAction,
  uploadOrdersAction,
  assignUnmatchedAction,
  saveBoardCodeAction,
  type SessionFormState,
  type UploadState,
} from "@/actions/sessions";
import type { ImportReport } from "@/lib/session-import";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/sms/phone";
import { hasEndedInTaipei } from "@/lib/board-expiry";

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
  endDate: string | null; // 結束日（多日課程用）；下架判斷以 endDate ?? eventDate 為準
  keywords: string[];
  isVisible: boolean;
  adminNote: string | null;
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
          max={24}
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
export function UploadOrdersForm({
  sessionOptions,
}: {
  sessionOptions: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState<UploadState, FormData>(
    uploadOrdersAction,
    null,
  );
  // 原生 file input 長得跟一般文字一樣，改成明顯的點擊區塊＋選檔後回饋
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  // 注意：匯入報告（含各組歸類表單）必須放在上傳 <form> 外面——
  // HTML 不允許巢狀 form，包在裡面會讓「歸入」按鈕誤觸發外層的重新上傳
  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2">
        <label
        className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition ${
          picked
            ? "border-indigo-300 bg-indigo-50"
            : "border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-indigo-50/50"
        }`}
      >
        <span className="text-2xl">📄</span>
        <span className="min-w-0 flex-1">
          {picked ? (
            <>
              <span className="block truncate text-sm font-medium text-indigo-800">
                {picked.name}
              </span>
              <span className="block text-xs text-indigo-500">
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
          <span className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700">
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
      <button
        disabled={pending || !picked}
        title={picked ? undefined : "請先選擇訂單檔"}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "匯入中，請勿關閉頁面…" : "上傳並歸類"}
      </button>
      </form>
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
                ⚠️ {state.report.unmatched.length} 種產品對不到場次關鍵字（尚未匯入）——
                常見原因是課程改過名（例如量子課曾叫「人生升級」）。請指定要歸入的場次：
              </div>
              <div className="mt-2 space-y-2">
                {state.report.unmatched.map((u) => (
                  <UnmatchedGroupForm
                    key={u.product}
                    group={u}
                    sessionOptions={sessionOptions}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 單一「對不到關鍵字」產品的歸類表單：選場次 → 歸入（可同時補關鍵字） */
function UnmatchedGroupForm({
  group,
  sessionOptions,
}: {
  group: ImportReport["unmatched"][number];
  sessionOptions: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    assignUnmatchedAction,
    null,
  );
  const selectRef = useRef<HTMLSelectElement>(null);

  // 歸類成功後這組就收起來，只留結果訊息
  if (state?.success) {
    return (
      <div className="rounded bg-green-50 px-2 py-1.5 text-green-700">✓ {state.success}</div>
    );
  }

  const namePreview = group.rows
    .slice(0, 5)
    .map((r) => r.name)
    .join("、");

  return (
    <form action={action} className="rounded border border-amber-200 bg-white/60 p-2">
      <div className="font-medium text-gray-700">
        {group.product}（{group.count} 筆）
      </div>
      <div className="mt-0.5 text-gray-500">
        {namePreview}
        {group.count > 5 && ` 等 ${group.count} 人`}
      </div>
      <input type="hidden" name="product" value={group.product} />
      <input type="hidden" name="rows" value={JSON.stringify(group.rows)} />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <select
          ref={selectRef}
          name="sessionId"
          required
          defaultValue=""
          className="rounded border border-gray-300 bg-white px-2 py-1 focus:border-black focus:outline-none"
        >
          <option value="" disabled>
            選擇要歸入的場次
          </option>
          {sessionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          {/* 預設勾選：補了關鍵字，之後再傳同名訂單檔就自動歸類，不必再問一次 */}
          <input type="checkbox" name="addKeyword" defaultChecked />
          同時加入該場次關鍵字
        </label>
        <button
          disabled={pending}
          onClick={(e) => {
            const title =
              selectRef.current?.selectedOptions[0]?.textContent ?? "";
            if (!selectRef.current?.value) return; // 交給 required 擋
            if (
              !confirm(
                `把「${group.product}」${group.count} 筆報名歸入「${title}」？`,
              )
            )
              e.preventDefault();
          }}
          className="rounded bg-black px-3 py-1 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "歸入中…" : "歸入"}
        </button>
      </div>
      {state?.error && <p className="mt-1 text-red-600">{state.error}</p>}
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
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          開課日
          <input
            type="date"
            name="eventDate"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none"
          />
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-gray-500"
          title="多日課程填最後一天；留空以開課日為準。過了隔天看板自動下架"
        >
          結束日
          <input
            type="date"
            name="endDate"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none"
          />
        </label>
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
      <textarea
        name="adminNote"
        rows={3}
        maxLength={5000}
        placeholder="場次備忘錄（僅後台管理可見；例：兩人合報送講座門票，但可個別結帳）"
        className="w-full resize-y rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
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
  const [isRetrain, setIsRetrain] = useState(false);
  // 受控欄位：React 19 表單在 action 完成後會重置未受控欄位——「查無手機→勾確認→重送」
  // 是設計好的正常路徑，錯誤回來把欄位清空會逼管理員整組重打
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // 只在「這次送出成功」那一刻清空一次（比對 state 物件變化，不能只看 success——
  // 它會留到下一輪，成功後再打的新資料會被誤清）
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setName("");
      setPhone("");
      setEmail("");
    }
  }
  return (
    <form action={action} className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3">
      <div className="text-xs font-medium text-gray-500">
        手動新增報名（電話報名、現金付款、特殊訂單等不經訂單檔的情況）
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="姓名（必填）"
          className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        {/* 手機：舊生資格核對的識別鍵，也是上課提醒簡訊的收件號碼 */}
        <input
          name="phone"
          inputMode="numeric"
          required={isRetrain}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={isRetrain ? "手機（複訓必填，09xxxxxxxx）" : "手機（選填，09xxxxxxxx）"}
          className="w-52 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        {/* Email 選填：夫妻／親子共用信箱很常見，不能拿來認人 */}
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email（選填）"
          className="w-52 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
        {/* 受控：React 19 送出後會重置未受控欄位，錯誤回來時下拉若悄悄跳回「新生」，
            管理員重送就會被當新生寫入（不建檔、不標複訓）——用 state 鎖住選擇 */}
        <select
          name="type"
          value={isRetrain ? "retrain" : "new"}
          onChange={(e) => setIsRetrain(e.target.value === "retrain")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        >
          <option value="new">新生</option>
          <option value="retrain">舊生（複訓）</option>
        </select>
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
      {/* 舊生資格以手機核對學員資料庫；查無號碼時勾這裡即一併建檔（資料庫逐步累積） */}
      {isRetrain && (
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" name="confirmOldStudent" className="h-3.5 w-3.5" />
          學員資料庫查無這支手機時，確認為舊生並一併建檔
        </label>
      )}
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
        {canEdit && session.adminNote && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            有備忘錄
          </span>
        )}
        {session.isVisible && hasEndedInTaipei(session.endDate ?? session.eventDate) && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
            已結束（看板已下架）
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
              <label className="flex items-center gap-1.5 text-sm text-gray-500">
                開課日
                <input
                  type="date"
                  name="eventDate"
                  defaultValue={session.eventDate ? session.eventDate.slice(0, 10) : ""}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-black focus:outline-none"
                />
              </label>
              <label
                className="flex items-center gap-1.5 text-sm text-gray-500"
                title="多日課程填最後一天；留空以開課日為準。過了隔天看板自動下架"
              >
                結束日
                <input
                  type="date"
                  name="endDate"
                  defaultValue={session.endDate ? session.endDate.slice(0, 10) : ""}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-black focus:outline-none"
                />
              </label>
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
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-amber-800">
                場次備忘錄（僅後台管理可見，不會顯示於公開看板）
              </span>
              <textarea
                name="adminNote"
                rows={4}
                maxLength={5000}
                defaultValue={session.adminNote ?? ""}
                placeholder="例：兩人合報送講座門票，但學員可個別結帳；請手動註記。"
                className="w-full resize-y rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
              />
            </label>
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
                <th className="px-2 py-1.5">手機</th>
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
                  <td
                    className={`px-2 py-1.5 font-mono text-xs ${
                      s.phone ? "text-gray-500" : "text-amber-600"
                    }`}
                    title={s.phone ? undefined : "沒有手機號碼，收不到上課提醒簡訊"}
                  >
                    {s.phone ? formatMobile(s.phone) : "無"}
                  </td>
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
