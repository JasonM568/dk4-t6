"use client";

import { useActionState, useState } from "react";
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
import { formatMobile, isOverseasPhone } from "@/lib/sms/phone";

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
  endDate: string | null; // 結束日：過了隔天（台北時間）看板下架＋報名頁自動關閉；null = 不自動結束
  unpublishAt: string | null; // 精確下架時間；到點立即從首頁/看板隱藏並關閉報名
  requests: WebinarRequestRow[];
};

const DEFAULT_EMAIL_BODY = `您好，感謝索取講座連結！

點擊下方按鈕即可進入講座：

[▶️ 進入講座]({link})

若按鈕無法點擊，請直接開啟：{link}

希望學院 敬上`;

function Feedback({ state }: { state: WebinarFormState }) {
  if (!state) return null;
  return state.error ? (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
  ) : state.success ? (
    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{state.success}</div>
  ) : null;
}

function WebinarFields({
  groups,
  initial,
}: {
  groups: WebinarGroupOption[];
  initial?: WebinarRow;
}) {
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
          placeholder="講座標題"
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
        placeholder="頁面說明（講座時間、講者、內容簡介…）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <input
        name="lectureUrl"
        required
        defaultValue={initial?.lectureUrl ?? ""}
        placeholder="講座連結（https://…，只出現在信裡不露出在頁面）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
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

      {/* 講座 DM 圖：瀏覽器直傳 Storage（同課程封面），存公開網址 */}
      <div className="rounded-lg border border-dashed border-gray-300 p-3">
        <div className="mb-1.5 text-xs font-medium text-gray-500">
          講座 DM 圖（選填，顯示在報名頁說明上方；JPG/PNG/WebP，5MB 內）
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
        placeholder="信件主旨（例：您的講座連結來了｜希望學院）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <textarea
        name="emailBody"
        rows={8}
        defaultValue={initial?.emailBody ?? DEFAULT_EMAIL_BODY}
        placeholder="信件內文"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
      />
      <p className="text-xs text-gray-400">
        {"{link}"} = 講座連結；[按鈕文字](網址) 會變成紅色 CTA 按鈕。內文沒放 {"{link}"}
        時系統會自動在信末補「進入講座」按鈕。
      </p>
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
          {pending ? "建立中…" : "建立講座頁"}
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
        <span className="font-mono text-xs text-gray-400">/webinar/{webinar.slug}</span>
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
