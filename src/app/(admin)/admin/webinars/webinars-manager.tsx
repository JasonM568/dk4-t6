"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  createWebinarAction,
  updateWebinarAction,
  deleteWebinarAction,
  updateWebinarRequestAction,
  deleteWebinarRequestAction,
  type WebinarFormState,
} from "@/actions/webinar";
import { requestCourseImageUploadUrl } from "@/actions/admin";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { MAX_QUESTIONS, QUESTION_TYPE_LABEL, QUESTION_TYPES } from "@/lib/webinar-survey";
import { defaultEmailBody } from "@/lib/webinar-mail";
import { formatMobile, isOverseasPhone } from "@/lib/sms/phone";
import {
  BackfillPhonesButton,
  BlockedAttempts,
  CopyPhonesButton,
  type BlockedAttemptRow,
} from "./webinar-actions";

// 圖片限制（與課程封面上傳一致；bytes 直傳 Storage 不經 server action body）
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

async function uploadDmImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return { ok: false, error: "格式不支援（限 JPG/PNG/WebP/GIF）" };
  if (file.size > MAX_IMAGE_BYTES)
    return { ok: false, error: "圖片超過 5MB，請壓縮後再上傳" };
  const signed = await requestCourseImageUploadUrl(file.type, "webinar");
  if (!signed.ok) return { ok: false, error: signed.error };
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
  if (error) return { ok: false, error: `上傳失敗：${error.message}` };
  return { ok: true, url: signed.publicUrl };
}

export type WebinarGroupOption = { id: string; name: string };
export type WebinarRequestRow = {
  id: string;
  email: string;
  name: string | null;
  sentCount: number;
  lastSentAt: string | null;
  createdAt: string;
  phone: string | null; // 09XXXXXXXX 或海外 E.164；null = 2026-09-02 手機必填上線前的舊紀錄
  deliveryStatus: string | null; // SENT/DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED/FAILED；null = 舊資料
  deliveryDetail: string | null; // 退信/失敗原因
};

// 寄送狀態標籤（null = 追蹤功能上線前的舊資料，不顯示）
const DELIVERY_BADGES: Record<string, { label: string; className: string }> = {
  SENT: { label: "已寄出", className: "bg-gray-100 text-gray-500" },
  DELIVERED: { label: "已送達", className: "bg-green-50 text-green-700" },
  OPENED: { label: "已開信", className: "bg-green-100 text-green-800" },
  CLICKED: { label: "已點擊", className: "bg-emerald-100 text-emerald-800" },
  BOUNCED: { label: "退信", className: "bg-red-100 text-red-700" },
  COMPLAINED: { label: "檢舉垃圾信", className: "bg-red-100 text-red-700" },
  FAILED: { label: "寄送失敗", className: "bg-red-50 text-red-600" },
};

function DeliveryBadge({ request }: { request: WebinarRequestRow }) {
  const badge = request.deliveryStatus
    ? DELIVERY_BADGES[request.deliveryStatus]
    : null;
  if (!badge) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}
      title={request.deliveryDetail ?? undefined}
    >
      {badge.label}
    </span>
  );
}
export type WebinarRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  lectureUrl: string;
  meetingId: string | null;
  meetingPassword: string | null;
  meetingInfo: string | null;
  dmImage: string | null;
  emailSubject: string;
  emailBody: string;
  groupId: string | null;
  isActive: boolean;
  kind: string; // WEBINAR／RESOURCE
  assets: { id: string; title: string; url: string; note: string | null }[];
  questions: { id: string; label: string; type: string; options: string[]; required: boolean }[];
  endDate: string | null; // 結束日：過了隔天（台北時間）看板下架＋報名頁自動關閉；null = 不自動結束
  unpublishAt: string | null; // 精確下架時間；到點立即從首頁/看板隱藏並關閉報名
  requests: WebinarRequestRow[];
  /** 被蜜罐擋下且尚未處理的送出（以為登記成功、其實沒有的人） */
  blockedAttempts: BlockedAttemptRow[];
};

// 預設信件內文由 lib/webinar-mail 的 defaultEmailBody(kind) 提供，依類型切換

function Feedback({ state }: { state: WebinarFormState }) {
  if (!state) return null;
  return state.error ? (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
  ) : state.success ? (
    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{state.success}</div>
  ) : null;
}

type AssetDraft = { title: string; url: string; note: string };
type QuestionDraft = { id: string | null; label: string; type: string; options: string; required: boolean };

/** 素材清單編輯器：受控列表，序列化成 assetsJson 交給 action */
function AssetsEditor({ initial }: { initial: AssetDraft[] }) {
  const [rows, setRows] = useState<AssetDraft[]>(initial);
  const set = (i: number, patch: Partial<AssetDraft>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const cls = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none";
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-3">
      <input type="hidden" name="assetsJson" value={JSON.stringify(rows)} />
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          素材清單（影片、講義、檔案；信裡會渲染成按鈕列，改這裡不必改信件內文）
        </span>
        <button type="button" onClick={() => setRows((r) => [...r, { title: "", url: "", note: "" }])}
          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">＋加一筆</button>
      </div>
      {rows.length === 0 && <p className="text-xs text-gray-400">還沒有素材。YouTube 未列出連結、Google Drive、Storage 網址都可以。</p>}
      <div className="space-y-2">
        {rows.map((a, i) => (
          <div key={i} className="grid gap-1.5 rounded-lg bg-gray-50 p-2 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
            <input value={a.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="按鈕文字（例：完整影片）" className={cls} />
            <input value={a.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://…" className={cls} />
            <input value={a.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="說明（選填）" className={cls} />
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 hover:text-black disabled:opacity-20">▲</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="px-1 hover:text-black disabled:opacity-20">▼</button>
              <button type="button" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="px-1 text-red-500 hover:text-red-700">刪</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 問卷編輯器：上限 MAX_QUESTIONS 題，序列化成 questionsJson。刪題由 action 軟刪。 */
function QuestionsEditor({ initial }: { initial: QuestionDraft[] }) {
  const [rows, setRows] = useState<QuestionDraft[]>(initial);
  const set = (i: number, patch: Partial<QuestionDraft>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const payload = rows.map((q) => ({
    id: q.id, label: q.label, type: q.type, required: q.required,
    options: q.options.split("\n").map((o) => o.trim()).filter(Boolean),
  }));
  const cls = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none";
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-3">
      <input type="hidden" name="questionsJson" value={JSON.stringify(payload)} />
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          問卷（選填；與姓名、Email、手機同一頁一次送出）{rows.length}／{MAX_QUESTIONS} 題
        </span>
        <button type="button" disabled={rows.length >= MAX_QUESTIONS}
          onClick={() => setRows((r) => [...r, { id: null, label: "", type: "SINGLE", options: "", required: false }])}
          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-40">＋加一題</button>
      </div>
      {rows.length === 0 && <p className="text-xs text-gray-400">沒有問卷時，訪客只填姓名、Email、手機。</p>}
      <div className="space-y-2">
        {rows.map((q, i) => (
          <div key={q.id ?? `new-${i}`} className="space-y-1.5 rounded-lg bg-gray-50 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">{i + 1}.</span>
              <input value={q.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="題目" className={`${cls} min-w-60 flex-1`} />
              <select value={q.type} onChange={(e) => set(i, { type: e.target.value })} className={cls}>
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} /> 必填
              </label>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 hover:text-black disabled:opacity-20">▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="px-1 hover:text-black disabled:opacity-20">▼</button>
                <button type="button" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="px-1 text-red-500 hover:text-red-700">刪</button>
              </span>
            </div>
            {q.type !== "TEXT" && (
              <textarea value={q.options} onChange={(e) => set(i, { options: e.target.value })} rows={3}
                placeholder={"選項，一行一個（至少兩個）\nFacebook\n朋友介紹"}
                className={`${cls} w-full font-mono`} />
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-400">刪掉的題目不會消失：已收到的答案仍保留題目文字，只是不再顯示給新訪客。</p>
    </div>
  );
}

function WebinarFields({
  groups,
  initial,
}: {
  groups: WebinarGroupOption[];
  initial?: WebinarRow;
}) {
  // 類型切換要即時改變欄位顯示，所以是 state；藏一個 hidden 給 action
  const [kind, setKind] = useState<string>(initial?.kind ?? "WEBINAR");
  const isResource = kind === "RESOURCE";
  const [dmImage, setDmImage] = useState(initial?.dmImage ?? "");
  const [dmError, setDmError] = useState("");
  const [dmUploading, setDmUploading] = useState(false);
  const toTaipeiDatetimeLocal = (value: string | null | undefined) => {
    if (!value) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  };

  const onDmFile = async (file: File | undefined) => {
    if (!file) return;
    setDmError("");
    setDmUploading(true);
    const res = await uploadDmImage(file);
    setDmUploading(false);
    if (res.ok) setDmImage(res.url);
    else setDmError(res.error);
  };

  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-4 rounded-lg bg-gray-50 px-3 py-2 text-sm">
        <span className="text-xs font-medium text-gray-500">類型</span>
        <label className="flex items-center gap-1.5"><input type="radio" checked={!isResource} onChange={() => setKind("WEBINAR")} /> 線上講座（寄會議連結）</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={isResource} onChange={() => setKind("RESOURCE")} /> 素材索取（寄影片、講義、檔案）</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          name="slug"
          required
          defaultValue={initial?.slug ?? ""}
          placeholder="網址代稱（小寫英數-，例：ai-webinar-0815）"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ""}
          placeholder={isResource ? "頁面標題（例：完整影片＋講義索取）" : "講座標題"}
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} />
          開放報名
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-gray-500"
          title="講座結束日：當天照常，隔天起看板自動下架、報名頁自動顯示已結束。留空 = 不自動結束"
        >
          結束日
          <input
            type="date"
            name="endDate"
            defaultValue={initial?.endDate ? initial.endDate.slice(0, 10) : ""}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-500" title="台灣時間；到點立即自動從首頁／看板下架並關閉報名">
          下架時間
          <input
            type="datetime-local"
            name="unpublishAt"
            defaultValue={toTaipeiDatetimeLocal(initial?.unpublishAt)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none"
          />
        </label>
      </div>
      <textarea
        name="description"
        rows={3}
        defaultValue={initial?.description ?? ""}
        placeholder={isResource ? "頁面說明（這份資料是什麼、填完會收到什麼…）" : "頁面說明（講座時間、講者、內容簡介…）"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <input
        name="lectureUrl"
        required={!isResource}
        defaultValue={initial?.lectureUrl ?? ""}
        placeholder={isResource ? "主要連結（選填；沒填就用素材清單第一筆）" : "講座連結（https://…，只出現在信裡不露出在頁面）"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <AssetsEditor
        initial={(initial?.assets ?? []).map((a) => ({ title: a.title, url: a.url, note: a.note ?? "" }))}
      />
      {!isResource && (<>
      <div className="flex flex-wrap gap-2">
        <input
          name="meetingId"
          defaultValue={initial?.meetingId ?? ""}
          placeholder="會議 ID（選填）"
          className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="meetingPassword"
          defaultValue={initial?.meetingPassword ?? ""}
          placeholder="會議密碼（選填）"
          className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
      </div>
      <textarea
        name="meetingInfo"
        rows={2}
        defaultValue={initial?.meetingInfo ?? ""}
        placeholder="會議補充資訊（選填，例：8/15（五）19:30 開放進場，請提前 10 分鐘上線）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <p className="text-xs text-gray-400">
        有填密碼且講座連結沒帶 pwd 參數時，信裡的連結會自動加上 ?pwd=密碼；
        ID/密碼/補充資訊會附在信末「會議資訊」區塊（不露出在報名頁）。
        Zoom 建議直接貼邀請信裡含 pwd 的完整連結最保險。
      </p>

      </>)}
      {/* 講座 DM 圖：瀏覽器直傳 Storage（同課程封面），存公開網址 */}
      <div className="rounded-lg border border-dashed border-gray-300 p-3">
        <div className="mb-1.5 text-xs font-medium text-gray-500">
          {isResource ? "主視覺" : "講座 DM 圖"}（選填，顯示在頁面說明上方；JPG/PNG/WebP，5MB 內）
        </div>
        <input type="hidden" name="dmImage" value={dmImage} />
        <div className="flex flex-wrap items-center gap-3">
          {dmImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dmImage}
              alt="講座 DM 預覽"
              className="max-h-40 rounded-lg border border-gray-200"
            />
          )}
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              onChange={(e) => onDmFile(e.target.files?.[0])}
              className="text-sm"
            />
            {dmUploading && <span className="text-xs text-gray-400">上傳中…</span>}
            {dmImage && !dmUploading && (
              <button
                type="button"
                onClick={() => setDmImage("")}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
              >
                移除 DM
              </button>
            )}
          </div>
        </div>
        {dmError && <p className="mt-1 text-xs text-red-600">{dmError}</p>}
      </div>

      {/* 名單群組：選既有，或直接建新群組（填了新名稱優先） */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="groupId"
          defaultValue={initial?.groupId ?? ""}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
        >
          <option value="">— 不加入名單群組 —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              索取者加入：{g.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400">或</span>
        <input
          name="newGroupName"
          placeholder="建立新群組（例：0815講座名單）"
          className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <span className="text-xs text-gray-400">填了新群組名稱就建立並優先使用</span>
      </div>
      <input
        name="emailSubject"
        required
        defaultValue={initial?.emailSubject ?? ""}
        placeholder={isResource ? "信件主旨（例：你索取的完整影片與講義｜希望學院）" : "信件主旨（例：您的講座連結來了｜希望學院）"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <textarea
        // 建立時切換類型要換成該類型的模板（非受控欄位靠 key 重掛）；編輯既有頁面則保留原內文
        key={initial ? "edit" : kind}
        name="emailBody"
        rows={8}
        defaultValue={initial?.emailBody ?? defaultEmailBody(kind)}
        placeholder="信件內文"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
      />
      <p className="text-xs text-gray-400">
        {"{link}"} = {isResource ? "第一筆素材" : "講座連結"}；{"{assets}"} = 整份素材清單按鈕列；
        [按鈕文字](網址) 會變成紅色 CTA 按鈕。內文沒放這些變數時系統會自動在信末補上。
      </p>
      <QuestionsEditor
        initial={(initial?.questions ?? []).map((q) => ({
          id: q.id, label: q.label, type: q.type, required: q.required, options: q.options.join("\n"),
        }))}
      />
    </>
  );
}

export function CreateWebinarForm({ groups }: { groups: WebinarGroupOption[] }) {
  const [state, action, pending] = useActionState<WebinarFormState, FormData>(
    createWebinarAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <WebinarFields groups={groups} />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "建立中…" : "建立頁面"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** 索取名單單列：顯示模式 ⇄ 原地編輯（姓名/email），可移除 */
function RequestRow({
  request,
  index,
  canEdit,
}: {
  request: WebinarRequestRow;
  index: number;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<WebinarFormState, FormData>(
    updateWebinarRequestAction.bind(null, request.id),
    null,
  );

  if (editing) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2 py-1.5">
        <span className="w-6 font-mono text-sm text-gray-400">{index + 1}</span>
        <input
          name="name"
          defaultValue={request.name ?? ""}
          placeholder="姓名"
          className="w-32 rounded border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
        />
        <input
          name="email"
          type="email"
          required
          defaultValue={request.email}
          className="w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
        />
        {/* 手機不設 required：上線前的舊紀錄沒有號碼，不能逼管理員為了改個名字先編一個號碼出來 */}
        <input
          name="phone"
          type="tel"
          defaultValue={request.phone ?? ""}
          placeholder="手機"
          className="w-32 rounded border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
        />
        <button
          disabled={pending}
          className="rounded bg-black px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-50"
        >
          取消
        </button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state?.success && <span className="text-xs text-green-700">✓</span>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="w-6 font-mono text-gray-400">{index + 1}</span>
      <span className="w-32 truncate">{request.name ?? "—"}</span>
      <span className="w-64 truncate text-gray-600">{request.email}</span>
      <span
        className={`w-32 font-mono text-xs ${
          request.phone ? "text-gray-600" : "text-gray-300"
        }`}
        title={isOverseasPhone(request.phone) ? "海外門號，不發簡訊" : undefined}
      >
        {formatMobile(request.phone)}
        {isOverseasPhone(request.phone) && " 🌏"}
      </span>
      <DeliveryBadge request={request} />
      <span className="text-xs text-gray-400">寄 {request.sentCount} 次</span>
      <span className="text-xs text-gray-400">首次 {formatDate(request.createdAt)}</span>
      {request.lastSentAt && (
        <span className="text-xs text-gray-400">最後 {formatDate(request.lastSentAt)}</span>
      )}
      {canEdit && (
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
          >
            編輯
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`移除 ${request.name ?? request.email} 的索取紀錄？\n（已加入名單群組的 email 不受影響）`))
                deleteWebinarRequestAction(request.id);
            }}
            className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 transition hover:bg-red-50"
          >
            移除
          </button>
        </span>
      )}
    </div>
  );
}

export function WebinarCard({
  webinar,
  groups,
  canEdit,
}: {
  webinar: WebinarRow;
  groups: WebinarGroupOption[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<WebinarFormState, FormData>(
    updateWebinarAction.bind(null, webinar.id),
    null,
  );
  const url = `https://course.huangxi.info/webinar/${webinar.slug}`;
  const problemCount = webinar.requests.filter(
    (r) =>
      r.deliveryStatus === "BOUNCED" ||
      r.deliveryStatus === "COMPLAINED" ||
      r.deliveryStatus === "FAILED",
  ).length;
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-medium">{webinar.title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${webinar.kind === "RESOURCE" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
          {webinar.kind === "RESOURCE" ? "素材索取" : "線上講座"}
        </span>
        {/* 直接看活動頁。放在 <summary> 裡要擋掉冒泡，否則點連結會順手把卡片展開／收合 */}
        <a
          href={`/webinar/${webinar.slug}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-gray-400 underline decoration-dotted underline-offset-2 hover:text-indigo-600"
          title="在新分頁開啟活動頁"
        >
          /webinar/{webinar.slug} ↗
        </a>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-bold">
          {webinar.requests.length} 人索取
        </span>
        {problemCount > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
            {problemCount} 筆退信/失敗
          </span>
        )}
        {!webinar.isActive && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
            已關閉
          </span>
        )}
        {webinar.isActive && (hasEndedInTaipei(webinar.endDate) ||
          (!!webinar.unpublishAt && new Date(webinar.unpublishAt) <= new Date())) && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
            已結束（看板下架、報名頁已關）
          </span>
        )}
      </summary>
      <div className="space-y-4 border-t border-gray-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">報名頁網址：</span>
          <code className="rounded bg-gray-100 px-2 py-0.5 text-xs">{url}</code>
          <a
            href={`/webinar/${webinar.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-indigo-300 px-2 py-0.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50"
          >
            🔗 開啟活動頁
          </a>
          {/* 訪客登記後收到的那封信長什麼樣——與實際寄信同一段組裝程式碼 */}
          <Link
            href={`/admin/webinars/${webinar.id}/preview`}
            className="rounded border border-indigo-300 px-2 py-0.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50"
          >
            ✉️ 預覽索取信
          </Link>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(url)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-50"
          >
            複製
          </button>
        </div>

        {canEdit && (
          <form action={action} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <WebinarFields groups={groups} initial={webinar} />
            <div className="flex items-center gap-2">
              <button
                disabled={pending}
                className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
              >
                {pending ? "儲存中…" : "儲存修改"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `確定刪除講座頁「${webinar.title}」？\n${webinar.requests.length} 筆索取紀錄會一併刪除（已加入名單群組的 email 不受影響）。`,
                    )
                  )
                    deleteWebinarAction(webinar.id);
                }}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
              >
                刪除講座頁
              </button>
              <Feedback state={state} />
            </div>
          </form>
        )}

        {/* 被擋下的送出擺在名單「上方」：這些人以為自己報名好了，
            排在名單下面等於沒人看得到 */}
        <BlockedAttempts rows={webinar.blockedAttempts} />

        {/* 名單工具列：一鍵帶去發提醒簡訊，或把號碼複製出去給站外用 */}
        {webinar.requests.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/sms?webinar=${webinar.id}`}
              className="rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-700 transition hover:bg-indigo-50"
            >
              📱 發提醒簡訊
            </Link>
            <CopyPhonesButton requests={webinar.requests} />
            {/* CSV 含 email 與「被擋下」標記欄；複製手機名單只給有手機的那些 */}
            <a
              href={`/api/admin/webinars/${webinar.id}/requests.csv`}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-50"
            >
              ⬇ 匯出名單 CSV
            </a>
            {/* 缺手機的才需要比對；補齊了就不顯示，避免一顆按不出東西的按鈕 */}
            {webinar.requests.some((r) => !r.phone) && (
              <BackfillPhonesButton webinarId={webinar.id} />
            )}
          </div>
        )}
        {webinar.requests.length === 0 ? (
          <p className="text-sm text-gray-400">還沒有人索取</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {webinar.requests.map((r, i) => (
              <RequestRow key={r.id} index={i} request={r} canEdit={canEdit} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
