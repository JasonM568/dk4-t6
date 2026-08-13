"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import {
  createSessionAction,
  updateSessionAction,
  deleteSessionAction,
  addSignupAction,
  removeSignupAction,
  uploadOrdersAction,
  assignUnmatchedAction,
  saveBoardCodeAction,
  setSignupMealAction,
  setSignupGroupAction,
  setSignupNameAction,
  setGroupCapAction,
  autoGroupAction,
  deferSignupAction,
  undoDeferSignupAction,
  type SessionFormState,
  type UploadState,
} from "@/actions/sessions";
import type { ImportReport } from "@/lib/session-import";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/sms/phone";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import {
  isRetrainProduct,
  mealLabel,
  computeRosterStats,
  groupCountFor,
} from "@/lib/session-roster";

export type SignupRow = {
  id: string;
  orderNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  product: string | null;
  orderedAt: string | null;
  meal: string | null;
  groupNo: number | null;
  isStaff: boolean;
  deferredToSessionId: string | null;
  deferredFromSessionId: string | null;
};

export type SessionRow = {
  id: string;
  title: string;
  eventDate: string | null;
  endDate: string | null; // 結束日（多日課程用）；下架判斷以 endDate ?? eventDate 為準
  keywords: string[];
  isVisible: boolean;
  adminNote: string | null;
  groupCap: number;
  groupCaps: number[]; // 逐組上限覆寫（index 0 = 第 1 組；0 = 用預設）
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
          {state.report.companionCheck.length > 0 && (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <div className="font-medium">
                ⚠️ {state.report.companionCheck.length} 張訂單的人數與辨識到的報名者不符——
                同行學員資料可能沒填或格式認不得，請對照訂單原檔確認，缺的人用「手動新增」補：
              </div>
              <ul className="mt-1 space-y-0.5">
                {state.report.companionCheck.map((c) => (
                  <li key={c.orderNo}>
                    {c.name}（{c.orderNo}）：訂 {c.quantity} 位、辨識到 {c.found} 位
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!state.report.mealColumnFound ? (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              檔案裡找不到葷素欄位（餐點／用餐／葷素…），本批全部以「未標」匯入——
              統計時未標視為葷，可在名單上逐人改
            </div>
          ) : state.report.mealUnknown > 0 ? (
            <div className="text-xs text-amber-700">
              葷素未標 {state.report.mealUnknown} 筆（該欄空白；統計時視為葷）
            </div>
          ) : null}
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
  const [type, setType] = useState<"new" | "retrain" | "staff">("new");
  const isRetrain = type === "retrain";
  // 受控欄位：React 19 表單在 action 完成後會重置未受控欄位——「查無手機→勾確認→重送」
  // 是設計好的正常路徑，錯誤回來把欄位清空會逼管理員整組重打
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // 只在「這次送出成功」那一刻清空一次（比對 state 物件變化，不能只看 success——
  // 它會留到下一輪，成功後再打的新資料會被誤清）
  const [meal, setMeal] = useState<"MEAT" | "VEG">("MEAT");
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setName("");
      setPhone("");
      setEmail("");
      setMeal("MEAT");
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
          value={type}
          onChange={(e) => setType(e.target.value as "new" | "retrain" | "staff")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        >
          <option value="new">新生</option>
          <option value="retrain">舊生（複訓）</option>
          <option value="staff">工作人員</option>
        </select>
        {/* 受控理由同上：錯誤回來不能悄悄跳回葷 */}
        <select
          name="meal"
          value={meal}
          onChange={(e) => setMeal(e.target.value === "VEG" ? "VEG" : "MEAT")}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        >
          <option value="MEAT">葷</option>
          <option value="VEG">素</option>
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

/** 分組面板：每組上限 + 自動分組 + 各組摘要 */
function GroupPanel({ session }: { session: SessionRow }) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    autoGroupAction.bind(null, session.id),
    null,
  );
  const [cap, setCap] = useState(String(session.groupCap));
  // 工作人員不列入分組
  const active = session.signups.filter((s) => !s.deferredToSessionId && !s.isStaff);
  const grouped = active.filter((s) => s.groupNo != null);

  // 各組摘要：人數/新舊/素
  const summary = new Map<number, { count: number; retrain: number; veg: number }>();
  for (const s of grouped) {
    const g = summary.get(s.groupNo!) ?? { count: 0, retrain: 0, veg: 0 };
    g.count++;
    if (isRetrainProduct(s.product)) g.retrain++;
    if (s.meal === "VEG") g.veg++;
    summary.set(s.groupNo!, g);
  }

  return (
    <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <form
        action={action}
        onSubmit={(e) => {
          // confirm 只針對「重新分組」（會覆蓋手動調整）；補分組不動既有組別不必問
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          if (
            submitter?.value === "all" &&
            grouped.length > 0 &&
            !confirm("重新分組會覆蓋所有手動調整過的組別，繼續？")
          )
            e.preventDefault();
        }}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span className="font-medium text-indigo-900">自動分組</span>
        <label className="flex items-center gap-1.5 text-gray-600">
          每組上限
          <input
            name="cap"
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="w-14 rounded-lg border border-gray-300 px-2 py-1 text-center text-sm focus:border-black focus:outline-none"
          />
          人
        </label>
        <span className="text-xs text-gray-400">
          組數 = max(6, ⌈{active.length}÷上限⌉)；新舊生依報名順序平均散進各組
        </span>
        {/* 每日更新名單後的新報名：只補未分組的人進現有組，已分好的完全不動 */}
        {grouped.length > 0 && grouped.length < active.length && (
          <button
            name="mode"
            value="fill"
            disabled={pending}
            className="rounded-lg border border-indigo-400 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            {pending ? "分組中…" : `補分組（${active.length - grouped.length} 位未分組）`}
          </button>
        )}
        <button
          name="mode"
          value="all"
          disabled={pending || active.length === 0}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "分組中…" : grouped.length > 0 ? "重新分組" : "自動分組"}
        </button>
      </form>
      {summary.size > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {[...summary.entries()]
            .sort(([a], [b]) => a - b)
            .map(([groupNo, g]) => (
              <span
                key={groupNo}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-gray-600 ring-1 ring-indigo-100"
              >
                第 {groupNo} 組 {g.count} 人｜新 {g.count - g.retrain} 舊 {g.retrain}
                {g.veg > 0 && `｜素 ${g.veg}`}
                {/* 逐組上限：場地桌子大小不一時逐組調；留空 = 用場次預設，補分組/重新分組都吃這個 */}
                <span className="text-gray-400">上限</span>
                <input
                  inputMode="numeric"
                  defaultValue={session.groupCaps[groupNo - 1] || ""}
                  placeholder={String(session.groupCap)}
                  title="這一組的人數上限（留空用場次預設）"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const parsed = raw ? Math.floor(Number(raw)) : 0;
                    const prev = session.groupCaps[groupNo - 1] || 0;
                    if (raw && (!Number.isInteger(parsed) || parsed < 1 || parsed > 99)) {
                      e.target.value = prev ? String(prev) : "";
                      return;
                    }
                    if (parsed !== prev)
                      startTransition(() => setGroupCapAction(session.id, groupNo, parsed));
                  }}
                  className="w-9 rounded border border-gray-200 px-1 py-0 text-center text-xs focus:border-black focus:outline-none"
                />
              </span>
            ))}
          {grouped.length < active.length && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              未分組 {active.length - grouped.length} 人
            </span>
          )}
        </div>
      )}
      <Feedback state={state} />
    </div>
  );
}

/** 場次卡片：報名名單 + 編輯 + 刪除 + 分組 + 延期 */
export function SessionCard({
  session,
  canEdit,
  sessionOptions,
}: {
  session: SessionRow;
  canEdit: boolean;
  sessionOptions: { id: string; title: string }[];
}) {
  const [editState, editAction, editing] = useActionState<SessionFormState, FormData>(
    updateSessionAction.bind(null, session.id),
    null,
  );
  const [deferState, deferDispatch] = useActionState<SessionFormState, FormData>(
    deferSignupAction,
    null,
  );
  const sessionTitle = (id: string | null) =>
    sessionOptions.find((o) => o.id === id)?.title ?? "其他場次";
  const stats = computeRosterStats(session.signups);
  // 手動指定組別的選單範圍：已用到的最大組號與公式組數取大者
  const maxGroupNo = Math.max(
    groupCountFor(stats.total, session.groupCap),
    ...session.signups.map((s) => s.groupNo ?? 0),
  );
  // 有效名單的流水編號（延出列不佔號）
  let rowNum = 0;
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-medium">{session.title}</span>
        {session.eventDate && (
          <span className="text-sm text-gray-400">{formatDate(session.eventDate)}</span>
        )}
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-bold">
          {stats.total} 人
        </span>
        <span className="text-xs text-gray-400">
          新生 {stats.fresh}｜舊生 {stats.retrain}
          {stats.staff > 0 && `｜工作人員 ${stats.staff}`}
          ｜葷 {stats.meat} 素 {stats.veg}
          {stats.mealUnknown > 0 && (
            <span title="未標葷素，統計時視為葷">（未標 {stats.mealUnknown}）</span>
          )}
          {stats.deferredOut > 0 && `｜延期 ${stats.deferredOut}`}
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

        {canEdit && session.signups.length > 0 && (
          <>
            <GroupPanel session={session} />
            <Feedback state={deferState} />
            <a
              href={`/api/admin/sessions/${session.id}/signin-sheet`}
              download
              className="inline-block rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100"
            >
              ⬇︎ 匯出簽到表（Excel，依組別排序＋用餐彙總）
            </a>
          </>
        )}

        {session.signups.length === 0 ? (
          <p className="text-sm text-gray-400">還沒有報名資料——上傳訂單檔後自動歸入，或用上方手動新增</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">姓名</th>
                <th className="px-2 py-1.5">葷素</th>
                <th className="px-2 py-1.5">組別</th>
                <th className="px-2 py-1.5">手機</th>
                <th className="px-2 py-1.5">訂單編號</th>
                <th className="px-2 py-1.5">產品</th>
                <th className="px-2 py-1.5">訂單日期</th>
                {canEdit && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {session.signups.map((s) => {
                const deferredOut = !!s.deferredToSessionId;
                return (
                <tr key={s.id} className={deferredOut ? "opacity-50" : undefined}>
                  <td className="px-2 py-1.5 font-mono text-gray-400">
                    {deferredOut || s.isStaff ? "—" : ++rowNum}
                  </td>
                  <td className="px-2 py-1.5">
                    {canEdit && !deferredOut ? (
                      /* 姓名可編輯：學員常填英文名，離開欄位即存（例改成「Polly cheng（鄭寶莉）」）。
                         key 用 s.name：存檔後 server 資料回來時讓 defaultValue 重掛 */
                      <input
                        key={s.name}
                        defaultValue={s.name}
                        title="點擊修改姓名（例：英文名補中文），離開欄位自動儲存"
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (!value) {
                            e.target.value = s.name;
                            return;
                          }
                          if (value !== s.name)
                            startTransition(() => setSignupNameAction(s.id, value));
                        }}
                        className="w-36 rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-black focus:outline-none"
                      />
                    ) : (
                      s.name
                    )}
                    {s.isStaff ? (
                      <span className="ml-1 rounded bg-indigo-100 px-1 text-xs text-indigo-700">工作人員</span>
                    ) : isRetrainProduct(s.product) ? (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">複訓</span>
                    ) : null}
                    {deferredOut && (
                      <span className="ml-1 rounded bg-gray-200 px-1.5 text-xs text-gray-500">
                        延期→{sessionTitle(s.deferredToSessionId)}
                      </span>
                    )}
                    {s.deferredFromSessionId && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-700">
                        延期自 {sessionTitle(s.deferredFromSessionId)}
                      </span>
                    )}
                  </td>
                  {/* 葷素：下拉直選（延出列不給改） */}
                  <td className="px-2 py-1.5 text-xs">
                    {canEdit && !deferredOut ? (
                      <select
                        value={s.meal === "VEG" || s.meal === "MEAT" ? s.meal : ""}
                        onChange={(e) =>
                          setSignupMealAction(
                            s.id,
                            e.target.value === "VEG" || e.target.value === "MEAT"
                              ? e.target.value
                              : null,
                          )
                        }
                        className={`rounded border bg-white px-1.5 py-0.5 text-xs focus:border-black focus:outline-none ${
                          s.meal === "VEG"
                            ? "border-green-300 text-green-700"
                            : s.meal === "MEAT"
                              ? "border-gray-300 text-gray-600"
                              : "border-amber-300 text-amber-700"
                        }`}
                      >
                        <option value="MEAT">葷</option>
                        <option value="VEG">素</option>
                        <option value="">未標</option>
                      </select>
                    ) : (
                      <span className="text-gray-500">{deferredOut ? "—" : mealLabel(s.meal)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {canEdit && !deferredOut && !s.isStaff ? (
                      <select
                        value={s.groupNo ?? ""}
                        onChange={(e) =>
                          setSignupGroupAction(
                            s.id,
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs focus:border-black focus:outline-none"
                      >
                        <option value="">未分組</option>
                        {Array.from({ length: maxGroupNo }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>第 {n} 組</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-500">
                        {deferredOut || s.isStaff ? "—" : s.groupNo ? `第 ${s.groupNo} 組` : "未分組"}
                      </span>
                    )}
                  </td>
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
                      <span className="inline-flex items-center gap-1">
                        {deferredOut ? (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`取消 ${s.name} 的延期？對方場次那筆會一併移除。`)) return;
                              const res = await undoDeferSignupAction(s.id);
                              if (res?.error) alert(res.error);
                            }}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
                          >
                            取消延期
                          </button>
                        ) : (
                          sessionOptions.length > 1 && (
                            <select
                              value=""
                              title="延期到其他場次"
                              onChange={(e) => {
                                const target = e.target.value;
                                e.target.value = "";
                                if (!target) return;
                                if (
                                  !confirm(
                                    `把 ${s.name} 延期到「${sessionTitle(target)}」？\n本場次保留紀錄並標記延期，不再計入統計。`,
                                  )
                                )
                                  return;
                                const fd = new FormData();
                                fd.set("signupId", s.id);
                                fd.set("targetSessionId", target);
                                startTransition(() => deferDispatch(fd));
                              }}
                              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-500 focus:border-black focus:outline-none"
                            >
                              <option value="">延期…</option>
                              {sessionOptions
                                .filter((o) => o.id !== session.id)
                                .map((o) => (
                                  <option key={o.id} value={o.id}>{o.title}</option>
                                ))}
                            </select>
                          )
                        )}
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
                      </span>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
