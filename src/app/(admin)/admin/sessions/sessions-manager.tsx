"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
  setSignupPhoneAction,
  setSignupTypeAction,
  setGroupCapAction,
  autoGroupAction,
  deferSignupAction,
  undoDeferSignupAction,
  saveSessionToMailGroupAction,
  saveSessionLiveAction,
  searchAttendeeAction,
  type AttendeeCandidate,
  type AttendeeSearchResult,
  type SessionFormState,
  type UploadState,
} from "@/actions/sessions";
import Link from "next/link";
import type { ImportReport } from "@/lib/session-import";
import { formatDate } from "@/lib/format";
import { formatMobile, normalizeContactPhone, isOverseasPhone } from "@/lib/sms/phone";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import {
  isRetrainSignup,
  mealLabel,
  computeRosterStats,
  groupCountFor,
} from "@/lib/session-roster";
// 比對規則與公開看板（/board）共用，同一關鍵字兩邊查出同一批人
import {
  normalizeQuery,
  matchesText,
  matchesTag,
  isSearchableQuery,
} from "@/lib/roster-search";
// 講座型場次判斷與收支表模板共用同一條規則（人工指定優先、否則看名稱）
import { deriveFinanceTemplate } from "@/lib/finance/labels";
import { computeNoticeProgress } from "@/lib/session-notice";

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
  isRetrain: boolean | null; // 新舊生人工覆寫；null = 依產品名自動判斷
  deferredToSessionId: string | null;
  deferredFromSessionId: string | null;
  // 課前通知已送達的時間（null = 還沒通知到）；場次卡片據此算「還有誰沒收到」
  smsNoticeAt: string | null;
  emailNoticeAt: string | null;
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
  // 上課連結（/live 憑碼索取）；accessCode 有值 = 這場已開放索取
  accessCode: string | null;
  meetingUrl: string | null;
  meetingId: string | null;
  meetingPassword: string | null;
  meetingInfo: string | null;
  // 收支表模板（QUANTUM/GENERAL/SEMINAR；null = 依名稱自動判斷）。
  // 名單列表沿用同一判斷：講座型（SEMINAR）不顯示葷素與組別欄
  financeTemplate: string | null;
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
          {/* 這次真的新增了誰——開課前重複匯入時，這份清單就是「要補通知的人」。
              通知走「只發還沒收到的人」，所以不必記住是哪一批，漏掉的下次也會撈回來 */}
          {state.report.added.length > 0 && (
            <div className="rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
              <div className="font-medium">
                ✅ 這次新增 {state.report.added.length} 位：
              </div>
              <ul className="mt-1 space-y-0.5">
                {state.report.added.map((a) => (
                  <li key={a.id}>
                    {a.name}
                    <span className="ml-1 text-emerald-700/70">
                      {a.phone ? formatMobile(a.phone) : "無手機"}
                      {a.email ? `・${a.email}` : ""}
                    </span>
                    <span className="ml-1 text-emerald-700/50">{a.sessionTitle}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {[...new Set(state.report.added.map((a) => a.sessionId))].map((sid) => (
                  <Link
                    key={sid}
                    href={`/admin/sms?session=${sid}&pending=1`}
                    className="rounded border border-emerald-400 bg-white px-2 py-1 font-medium text-emerald-800 transition hover:bg-emerald-100"
                  >
                    📱 通知這場還沒收到的人
                  </Link>
                ))}
              </div>
            </div>
          )}
          {state.report.companionCheck.length > 0 && (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <div className="font-medium">
                ⚠️ {state.report.companionCheck.length} 張訂單買的席次比辨識到的人多——
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
          {state.report.seatOverflow.length > 0 && (
            <div className="rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-600">
              <div className="font-medium">
                只買 1 席卻在同行欄填了名字（{state.report.seatOverflow.length} 張訂單）——
                那是「跟誰一起上課」，不是多買位子，所以沒有列入名單（對方多半自己下單）。
                若對方確實沒下單卻要來，請用「手動新增」補：
              </div>
              <ul className="mt-1 space-y-0.5">
                {state.report.seatOverflow.map((o) => (
                  <li key={`${o.orderNo}-${o.dropped.join()}`}>
                    {o.name}（{o.orderNo}）買 {o.seats} 席，同行欄填了 {o.dropped.join("、")}
                    {o.sessionTitle && `｜${o.sessionTitle}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.report.dupSkipped.length > 0 && (
            <div className="rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-600">
              <div className="font-medium">
                同一場次同一個人、但訂單編號不同 → 沒有重複建列（{state.report.dupSkipped.length} 筆）。
                名單上已有那個人，這是正常的；只有在「其實是同名的不同人」時才要手動新增：
              </div>
              <ul className="mt-1 space-y-0.5">
                {state.report.dupSkipped.map((d) => (
                  <li key={`${d.orderNo}-${d.name}`}>
                    {d.name}（本次訂單 {d.orderNo}）－ 名單上那筆是訂單 {d.existingOrderNo}
                    {d.sessionTitle && `｜${d.sessionTitle}`}
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
/** 找人：輸入姓名／手機／Email 的一部分，把系統裡已有的人撈出來一鍵帶入。
 *
 *  來源是會員、既有場次名單與學員資料庫（見 searchAttendeeAction）。
 *  只填欄位、不直接送出——同名不同人在實務上很常見，最後仍要由管理員確認。 */
function AttendeeFinder({
  rosterNames,
  onPick,
}: {
  rosterNames: Set<string>;
  onPick: (c: AttendeeCandidate) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{
    key: string;
    data: AttendeeSearchResult;
  } | null>(null);
  const [searching, startSearch] = useTransition();
  const term = q.trim();
  const current = results?.key === term ? results.data : null;

  // debounce 350ms；server action 是循序 POST，需擋過期回應（同群發試算那套）
  useEffect(() => {
    if (!isSearchableQuery(term)) return;
    let alive = true;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const data = await searchAttendeeAction(term);
        if (alive) setResults({ key: term, data });
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        🔍 先找找看系統裡有沒有這個人
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="輸入姓名、手機或 Email（中文一個字即可）"
          // type=search 才有清除鈕；不放在 form 的具名欄位裡，不會被一起送出
          type="search"
          className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
      </label>

      {isSearchableQuery(term) && (
        <div className="mt-2">
          {searching || !current ? (
            <p className="text-xs text-gray-400">搜尋中…</p>
          ) : current.candidates.length === 0 ? (
            <p className="text-xs text-gray-400">
              查無資料——這位可能是全新的學員，直接在下方填寫即可。
              <span className="mt-0.5 block">
                （已查：會員 {current.counts.members} 筆・場次名單{" "}
                {current.counts.signups} 筆・學員資料庫 {current.counts.students} 筆。
                用手機找不到會員是正常的——多數會員沒留手機，改用姓名或 Email 搜。）
              </span>
            </p>
          ) : (
            <>
            <p className="mb-1 text-xs text-gray-500">
              找到 {current.total} 人
              {current.total > current.candidates.length &&
                `（顯示前 ${current.candidates.length} 筆，再打幾個字可縮小範圍）`}
              　會員 {current.counts.members}・場次名單 {current.counts.signups}
              {current.counts.students > 0 && `・學員資料庫 ${current.counts.students}`}
            </p>
            <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {current.candidates.map((c, i) => {
                const already = rosterNames.has(c.name.trim().toLowerCase());
                return (
                  <li
                    key={`${c.phone ?? c.email ?? c.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-medium">{c.name}</span>
                        {c.isMember && (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                            會員
                          </span>
                        )}
                        {already && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            已在本場名單
                          </span>
                        )}
                        <span className="font-mono text-xs text-gray-500">
                          {c.phone ? formatMobile(c.phone) : "無手機"}
                        </span>
                        <span className="truncate text-xs text-gray-400">
                          {c.email ?? "無 Email"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">{c.sources.join("・")}</div>
                    </div>
                    {/* 明確的按鈕：整列可點但看不出可點，等於沒有這個功能 */}
                    <button
                      type="button"
                      onClick={() => {
                        onPick(c);
                        setQ("");
                        setResults(null);
                      }}
                      className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-700"
                    >
                      ＋ 帶入
                    </button>
                  </li>
                );
              })}
            </ul>
            </>
          )}
          <p className="mt-1 text-xs text-gray-400">
            按「＋ 帶入」把資料填進下方欄位（只填不送出，仍可自行修改）。
            同名不同人請先比對手機再帶入。
          </p>
        </div>
      )}
    </div>
  );
}

function AddSignupForm({
  sessionId,
  rosterNames,
}: {
  sessionId: string;
  /** 本場已在名單的人（姓名小寫）；找人結果標「已在名單」，免得重複加 */
  rosterNames: Set<string>;
}) {
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

      {/* 找人：多數手動新增的對象系統裡早就有資料（會員或曾報名過別場），
          重打一次不只費事，還會打出對不起來的姓名／號碼變成新的髒資料 */}
      <AttendeeFinder
        rosterNames={rosterNames}
        onPick={(c) => {
          setName(c.name);
          if (c.phone) setPhone(c.phone);
          if (c.email) setEmail(c.email);
        }}
      />

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
    if (isRetrainSignup(s)) g.retrain++;
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

/** 線上場次的上課資訊：Zoom 連結、會議 ID／密碼、課程資料，以及學員索取用的 4 位上課碼。
 *  發簡訊時把上課碼寫進去，學員到 /live 輸入即可自行取得連結。 */
function LiveInfoForm({ session }: { session: SessionRow }) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    saveSessionLiveAction.bind(null, session.id),
    null,
  );
  const [regenerate, setRegenerate] = useState(false);
  const open = !!session.meetingUrl;
  return (
    <details className="rounded-lg border border-sky-200 bg-sky-50/40" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-sky-800">
        🎥 上課連結（Zoom／上課碼）
        {session.accessCode ? (
          <span className="ml-1 font-normal text-sky-600">
            — 已開放，上課碼 {session.accessCode}
          </span>
        ) : (
          <span className="ml-1 font-normal text-gray-400">— 尚未設定</span>
        )}
      </summary>
      <form action={action} className="space-y-2 border-t border-sky-100 px-3 py-2">
        <input type="hidden" name="regenerate" value={regenerate ? "1" : "0"} />
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            會議連結（Zoom 等，完整網址；清空並儲存＝關閉索取並作廢上課碼）
          </span>
          <input
            name="meetingUrl"
            type="url"
            defaultValue={session.meetingUrl ?? ""}
            placeholder="https://us02web.zoom.us/j/..."
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            會議 ID
            <input
              name="meetingId"
              defaultValue={session.meetingId ?? ""}
              placeholder="853 1234 5678"
              className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
            />
          </label>
          <label
            className="flex items-center gap-1.5 text-xs text-gray-600"
            title="連結本身沒帶 pwd 參數時，會自動附加到連結上（Zoom 慣例）"
          >
            密碼
            <input
              name="meetingPassword"
              defaultValue={session.meetingPassword ?? ""}
              className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            上課碼
            <input
              name="accessCode"
              inputMode="numeric"
              maxLength={4}
              defaultValue={session.accessCode ?? ""}
              placeholder="自動產生"
              disabled={regenerate}
              className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-center font-mono text-sm focus:border-black focus:outline-none disabled:bg-gray-100"
            />
          </label>
          <label
            className="flex items-center gap-1.5 text-xs text-gray-600"
            title="換一組新碼：舊碼與學員已開啟的頁面立即失效"
          >
            <input
              type="checkbox"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
            />
            換新碼
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">
            課程資料與注意事項（學員看得到；一行一項，貼網址會自動變成連結）
          </span>
          <textarea
            name="meetingInfo"
            rows={4}
            maxLength={5000}
            defaultValue={session.meetingInfo ?? ""}
            placeholder={"請提早 10 分鐘進入教室，並將顯示名稱改為本名。\n講義下載：https://..."}
            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={pending}
            className="rounded-lg border border-sky-400 px-3 py-1.5 text-sm text-sky-800 transition hover:bg-sky-100 disabled:opacity-50"
          >
            {pending ? "儲存中…" : "儲存上課連結"}
          </button>
          {session.accessCode && (
            // 預覽：直接用一鍵連結開，看到的就是學員看到的那一頁
            //（會在這個瀏覽器種下該場次的 cookie，無妨）
            <a
              href={`/live/${session.accessCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              👁 預覽學員看到的畫面
            </a>
          )}
          <Feedback state={state} />
        </div>
        {session.accessCode && (
          // 簡訊字數很貴（中文 70 字/則），直接給可貼的範本省得每次重寫。
          // 一鍵連結是主推：學員點開即進，不必手打；手動輸入當備援。
          <div className="space-y-1 rounded-lg bg-white/70 px-2 py-1.5 text-xs text-gray-500">
            <p>
              一鍵連結（建議）：
              <span className="font-mono text-gray-700">
                course.huangxi.info/live/{session.accessCode}
              </span>
            </p>
            <p>
              手動輸入：course.huangxi.info/live 　上課碼{" "}
              <span className="font-mono text-gray-700">{session.accessCode}</span>
            </p>
            <p className="text-gray-400">
              簡訊／EDM 內文可用 {"{code}"} 變數自動帶入這組碼，不必每場手改。
            </p>
          </div>
        )}
      </form>
    </details>
  );
}

/** 把這場名單存成 EDM 名單群組（快照，供日後行銷用）。
 *
 *  刻意收在摺疊選單裡並寫明「課前通知不用這個」：課前通知走 EDM 群發的「場次報名者」
 *  才會在寄出當下取最新名單；存成群組是死的快照，拿它發課前通知會漏掉後來報名的人。 */
function SaveToMailGroupForm({ session }: { session: SessionRow }) {
  const [state, action, pending] = useActionState<SessionFormState, FormData>(
    saveSessionToMailGroupAction.bind(null, session.id),
    null,
  );
  return (
    <details className="rounded-lg border border-dashed border-gray-300">
      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500">
        📋 把這場名單存成 EDM 名單群組（日後行銷用）
      </summary>
      <form action={action} className="space-y-2 border-t border-gray-100 px-3 py-2">
        <p className="text-xs text-gray-500">
          存的是<strong>當下的快照</strong>，之後新報名的人不會自動加進去——
          課前通知請直接用上面的「發課前通知」勾這個場次。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="groupName"
            defaultValue={session.title}
            placeholder="群組名稱"
            className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
          />
          <button
            disabled={pending}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
          >
            {pending ? "存入中…" : "存入群組"}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          同名群組＝併入既有群組，重複的 Email 自動略過（重按不會長出重複名單）。
        </p>
        <Feedback state={state} />
      </form>
    </details>
  );
}

/** 場次卡片：報名名單 + 編輯 + 刪除 + 分組 + 延期 */
export function SessionCard({
  session,
  canEdit,
  isAdmin = false,
  sessionOptions,
}: {
  session: SessionRow;
  canEdit: boolean;
  isAdmin?: boolean; // 收支入口僅管理員（分潤金額是內部薪酬）
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
  // 課前通知進度：開課前重複匯入名單後，這裡直接看得出「還有誰沒收到」
  const notice = computeNoticeProgress(session.signups);
  // 講座型場次：不供餐、不分組——名單列表隱藏葷素與組別欄（版面也不再擠爆）
  const isSeminar =
    (session.financeTemplate ?? deriveFinanceTemplate(session.title)) === "SEMINAR";
  // 手動指定組別的選單範圍：已用到的最大組號與公式組數取大者
  const maxGroupNo = Math.max(
    groupCountFor(stats.total, session.groupCap),
    ...session.signups.map((s) => s.groupNo ?? 0),
  );

  // 名單搜尋（client 端過濾，不打 DB）。只影響表格顯示——
  // 上方統計、分組面板、簽到表匯出一律走完整名單，數字不會被搜尋條件帶偏。
  const [rawQuery, setRawQuery] = useState("");
  const query = normalizeQuery(rawQuery);
  const searching = query.length > 0;

  // 流水編號**先於過濾**算好：搜尋後仍顯示該人在完整名單中的號碼，
  // 否則同一個人搜尋前後號碼不同，跟簽到表對不起來。延出列與工作人員不佔號。
  const rowNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const s of session.signups) {
      if (!s.deferredToSessionId && !s.isStaff) map.set(s.id, ++n);
    }
    return map;
  }, [session.signups]);

  const visibleSignups = useMemo(() => {
    if (!searching) return session.signups;
    return session.signups.filter(
      (s) =>
        matchesText(query, s.name, s.product, s.orderNo, s.email, s.phone, s.phone ? formatMobile(s.phone) : null) ||
        matchesTag(query, s),
    );
  }, [session.signups, query, searching]);

  // 同行共用聯絡：同一支手機/信箱在這場掛了兩個以上不同姓名——
  // 多半是訂購人幫同行者填自己的聯絡方式，通知會全寄到訂購人那裡。
  // 標出來讓操作者知道要補同行者本人的電話/信箱
  const sharedContactIds = useMemo(() => {
    const namesByKey = new Map<string, Set<string>>();
    const keysOf = (s: { phone: string | null; email: string | null }) =>
      [s.phone && `p:${s.phone}`, s.email && `e:${s.email.toLowerCase()}`].filter(
        (k): k is string => !!k,
      );
    for (const s of session.signups)
      for (const k of keysOf(s))
        namesByKey.set(k, (namesByKey.get(k) ?? new Set()).add(s.name.replace(/\s+/g, "")));
    const ids = new Set<string>();
    for (const s of session.signups)
      if (keysOf(s).some((k) => (namesByKey.get(k)?.size ?? 0) > 1)) ids.add(s.id);
    return ids;
  }, [session.signups]);

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
        {/* 課前通知進度：全部發完才不顯示，開課前一眼看出還有誰漏掉 */}
        {(notice.smsPending > 0 || notice.emailPending > 0) &&
          (notice.smsDone > 0 || notice.emailDone > 0) && (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
              title="還沒收到課前通知的人數（送失敗的也算未通知）"
            >
              未通知 簡訊 {notice.smsPending}／Email {notice.emailPending}
            </span>
          )}
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
        {session.accessCode && (
          <span
            className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800"
            title="已開放 /live 憑碼索取上課連結"
          >
            🎥 上課碼 {session.accessCode}
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

        {canEdit && <LiveInfoForm session={session} />}

        {canEdit && (
          <AddSignupForm
            sessionId={session.id}
            rosterNames={
              new Set(
                session.signups
                  .filter((g) => !g.deferredToSessionId)
                  .map((g) => g.name.trim().toLowerCase()),
              )
            }
          />
        )}

        {canEdit && session.signups.length > 0 && (
          <>
            <GroupPanel session={session} />
            <Feedback state={deferState} />
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/admin/sessions/${session.id}/signin-sheet`}
                download
                className="inline-block rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100"
              >
                ⬇︎ 匯出簽到表（Excel，依組別排序＋用餐彙總）
              </a>
              {/* 帶 session id 過去：對方頁面會自動勾好這個場次並填好課前通知草稿，
                  管理員只要確認內容就能送出，不必再找一次場次、也不必重打內文 */}
              <Link
                href={`/admin/broadcast?session=${session.id}`}
                className="inline-block rounded-lg border border-indigo-400 px-3 py-1.5 text-sm text-indigo-700 transition hover:bg-indigo-50"
              >
                ✉️ 發課前通知（Email）
              </Link>
              <Link
                href={`/admin/sms?session=${session.id}`}
                className="inline-block rounded-lg border border-indigo-400 px-3 py-1.5 text-sm text-indigo-700 transition hover:bg-indigo-50"
              >
                📱 發課前通知（簡訊）
              </Link>
              {/* 開課前會重複匯入名單，多半只需要通知這次新進來的人。
                  口徑是「還沒收到課前簡訊的人」，所以漏發、送失敗的也會被撈回來 */}
              {notice.smsPending > 0 && notice.smsDone > 0 && (
                <Link
                  href={`/admin/sms?session=${session.id}&pending=1`}
                  className="inline-block rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                >
                  📱 只通知還沒收到的 {notice.smsPending} 人
                </Link>
              )}
              {/* 公開報名頁：DM 圖、課程資訊、名額與待確認報名都在那一頁 */}
              <Link
                href={`/admin/sessions/${session.id}/signup-page`}
                className="inline-block rounded-lg border border-rose-400 px-3 py-1.5 text-sm text-rose-700 transition hover:bg-rose-50"
              >
                📝 報名頁設定
              </Link>
              <Link
                href={`/admin/enrollments?sessionId=${session.id}`}
                className="inline-block rounded-lg border border-blue-500 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 transition hover:bg-blue-100"
              >
                🎬 處理課後影片權限
              </Link>
              <Link href={`/admin/sessions/${session.id}/history-sync`} className="inline-block rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 transition hover:bg-violet-100">📚 同步上課歷史</Link>
              {/* 收支含分潤金額（內部薪酬）：僅管理員可見；頁面本身也擋 pageGuardFullAdmin */}
              {isAdmin && (
                <Link
                  href={`/admin/finance/${session.id}`}
                  className="inline-block rounded-lg border border-emerald-400 px-3 py-1.5 text-sm text-emerald-700 transition hover:bg-emerald-50"
                >
                  💰 收支結算
                </Link>
              )}
            </div>
            <p className="text-xs text-gray-400">
              點下去會自動勾好這個場次、帶入課前通知草稿（含上課連結），確認內容即可送出。
              名單於送出當下解析，之後補報名的人自動涵蓋。
            </p>
            <SaveToMailGroupForm session={session} />
          </>
        )}

        {session.signups.length === 0 ? (
          <p className="text-sm text-gray-400">還沒有報名資料——上傳訂單檔後自動歸入，或用上方手動新增</p>
        ) : (
          <>
          {/* 這一場的名單搜尋：名單長了要找特定學員（改葷素、補手機、調組別）得整表用眼睛掃 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                🔍
              </span>
              <input
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="搜尋這場名單：姓名、手機、Email、訂單編號、方案，或「素」「複訓」「未分組」「第3組」"
                aria-label={`搜尋「${session.title}」的名單`}
                className="w-full rounded-lg border border-gray-300 py-1.5 pl-9 pr-16 text-sm focus:border-black focus:outline-none"
              />
              {rawQuery && (
                <button
                  type="button"
                  onClick={() => setRawQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-100"
                >
                  清除
                </button>
              )}
            </div>
            {searching && (
              <span className="text-xs text-gray-500">
                符合 {visibleSignups.length} 筆／共 {session.signups.length} 筆
              </span>
            )}
          </div>
          {searching && visibleSignups.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              這場沒有符合「{rawQuery}」的名單
            </p>
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">姓名</th>
                {!isSeminar && <th className="px-2 py-1.5">葷素</th>}
                {!isSeminar && <th className="px-2 py-1.5">組別</th>}
                <th className="px-2 py-1.5">聯絡（手機／Email）</th>
                <th className="px-2 py-1.5">產品／訂單</th>
                {canEdit && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleSignups.map((s) => {
                const deferredOut = !!s.deferredToSessionId;
                return (
                <tr key={s.id} className={deferredOut ? "opacity-50" : undefined}>
                  <td className="px-2 py-1.5 font-mono text-gray-400">
                    {rowNumbers.get(s.id) ?? "—"}
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
                    {/* 身分（新生／舊生／工作人員）：訂單買錯方案、家人代訂、事後才查出是舊生，
                        產品名判不出來——這裡直接改，統計、分組、簽到表、看板都跟著走。
                        延出列與唯讀角色只顯示徽章不給改。 */}
                    {canEdit && !deferredOut ? (
                      <select
                        value={s.isStaff ? "staff" : isRetrainSignup(s) ? "retrain" : "fresh"}
                        title="改身分：新生／舊生（複訓）／工作人員"
                        onChange={(e) => {
                          const next = e.target.value as "fresh" | "retrain" | "staff";
                          if (
                            next === "staff" &&
                            s.groupNo != null &&
                            !confirm(`把 ${s.name} 改為工作人員？工作人員不列入分組，現在的第 ${s.groupNo} 組會被清掉。`)
                          ) {
                            e.target.value = s.isStaff ? "staff" : isRetrainSignup(s) ? "retrain" : "fresh";
                            return;
                          }
                          startTransition(() => setSignupTypeAction(s.id, next));
                        }}
                        className={`ml-1 rounded border bg-white px-1 py-0.5 text-xs focus:border-black focus:outline-none ${
                          s.isStaff
                            ? "border-indigo-300 text-indigo-700"
                            : isRetrainSignup(s)
                              ? "border-amber-300 text-amber-700"
                              : "border-gray-300 text-gray-500"
                        }`}
                      >
                        <option value="fresh">新生</option>
                        <option value="retrain">舊生（複訓）</option>
                        <option value="staff">工作人員</option>
                      </select>
                    ) : s.isStaff ? (
                      <span className="ml-1 rounded bg-indigo-100 px-1 text-xs text-indigo-700">工作人員</span>
                    ) : isRetrainSignup(s) ? (
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
                  {/* 葷素：下拉直選（延出列不給改）；講座型場次不供餐，整欄隱藏 */}
                  {!isSeminar && (
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
                  )}
                  {!isSeminar && (
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
                  )}
                  {/* 手機：團報名單匯入時整批沒號碼，管理員在這裡逐人補（補上才收得到上課提醒簡訊）。
                      離開欄位即存、清空＝未填；格式由 server action 驗（09 開頭 10 碼，
                      海外門號加國碼存 E.164）。
                      key 用 s.phone：存檔後 server 資料回來時讓 defaultValue 重掛 */}
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {canEdit && !deferredOut ? (
                      <input
                        key={s.phone ?? ""}
                        defaultValue={s.phone ? formatMobile(s.phone) : ""}
                        placeholder="補手機"
                        title={
                          s.phone
                            ? "點擊修改手機，離開欄位自動儲存（清空＝未填）"
                            : "沒有手機號碼，收不到上課提醒簡訊——點這裡補，離開欄位自動儲存"
                        }
                        onBlur={async (e) => {
                          const raw = e.target.value.trim();
                          // normalizeContactPhone 而非 normalizeMobile：海外號在後者回 null，
                          // 會讓每次離開欄位都白打一次 server
                          const next = raw ? normalizeContactPhone(raw) : null;
                          // 沒動或只改了分隔符 → 還原成標準顯示，不打 server
                          const unchanged = raw ? next !== null && next === s.phone : !s.phone;
                          if (unchanged) {
                            e.target.value = next ? formatMobile(next) : "";
                            return;
                          }
                          const res = await setSignupPhoneAction(s.id, raw);
                          if (res?.error) {
                            alert(res.error);
                            e.target.focus(); // 留著原輸入讓管理員直接改
                          }
                        }}
                        className={`w-28 rounded border border-transparent px-1 py-0.5 font-mono hover:border-gray-300 focus:border-black focus:outline-none ${
                          s.phone
                            ? "text-gray-500"
                            : "text-amber-600 placeholder:text-amber-600"
                        }`}
                      />
                    ) : (
                      <span className={s.phone ? "text-gray-500" : "text-amber-600"}>
                        {s.phone ? formatMobile(s.phone) : "無"}
                      </span>
                    )}
                    {/* 海外門號：簡訊發不到（不發國際簡訊），要改寄 Email。
                        不標的話這個人看起來「有號碼＝會收到通知」，實際上不會 */}
                    {isOverseasPhone(s.phone) && (
                      <span
                        className="ml-1 whitespace-nowrap rounded bg-sky-50 px-1 py-0.5 text-[10px] font-sans text-sky-700"
                        title="海外門號：不發國際簡訊，上課通知請改寄 Email"
                      >
                        海外·Email
                      </span>
                    )}
                    {/* Email 併在手機下方（聯絡資訊一組）：各佔一欄會把表撐出卡片外。
                        同行者多半沒有（訂單只有訂購人填），顯示用；寄信名單以此為準 */}
                    <span className="flex items-center gap-1">
                      <span
                        className="block max-w-[10rem] truncate font-sans text-gray-400"
                        title={s.email ?? undefined}
                      >
                        {s.email ?? "—"}
                      </span>
                      {sharedContactIds.has(s.id) && (
                        <span
                          className="whitespace-nowrap rounded bg-orange-50 px-1 py-0.5 text-[10px] font-sans text-orange-700"
                          title="這支手機／信箱在本場掛了不只一個姓名——多半是訂購人幫同行者填自己的聯絡方式，通知會全寄到同一個人那裡；建議補同行者本人的電話或 Email"
                        >
                          共用
                        </span>
                      )}
                    </span>
                  </td>
                  {/* 產品＋訂單資訊併一欄：編號與日期是純參考，各佔一欄會把表撐出卡片外。
                      產品名經常超長（銷售頁全名），截斷防撐爆表格；游標懸停看全文 */}
                  <td className="px-2 py-1.5 text-xs text-gray-500">
                    <span className="block max-w-[13rem] truncate" title={s.product ?? undefined}>
                      {s.product ?? "—"}
                    </span>
                    <span className="block font-mono text-[11px] text-gray-400">
                      {s.orderNo}
                      {s.orderedAt ? `・${formatDate(s.orderedAt)}` : ""}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1">
                        {/* 單人補通知（晚報名/改號碼的人）：帶場次＋這個人到簡訊/EDM 頁，
                            名單欄自動填好這一位、內容帶課前通知草稿 */}
                        {!deferredOut && s.phone && !isOverseasPhone(s.phone) && (
                          <Link
                            href={`/admin/sms?session=${session.id}&signup=${s.id}`}
                            title={`只發簡訊給 ${s.name}（課前通知草稿自動帶入）`}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
                          >
                            簡訊
                          </Link>
                        )}
                        {!deferredOut && s.email && (
                          <Link
                            href={`/admin/broadcast?session=${session.id}&signup=${s.id}`}
                            title={`只寄 EDM 給 ${s.name}（課前通知草稿自動帶入）`}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
                          >
                            EDM
                          </Link>
                        )}
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
                              // w-16 鎖寬：select 收合寬度由「最長選項」決定，選項是其他場次
                              // 的完整標題，不鎖每張卡的表格都會被這顆下拉撐出卡片外
                              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-500 focus:border-black focus:outline-none"
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
          </div>
          )}
          </>
        )}
      </div>
    </details>
  );
}
