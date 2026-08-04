"use client";

import { useActionState } from "react";
import {
  createWebinarAction,
  updateWebinarAction,
  deleteWebinarAction,
  type WebinarFormState,
} from "@/actions/webinar";
import { formatDate } from "@/lib/format";

export type WebinarGroupOption = { id: string; name: string };
export type WebinarRequestRow = {
  id: string;
  email: string;
  sentCount: number;
  lastSentAt: string | null;
  createdAt: string;
};
export type WebinarRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  lectureUrl: string;
  emailSubject: string;
  emailBody: string;
  groupId: string | null;
  isActive: boolean;
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
      </div>
      <textarea
        name="description"
        rows={3}
        defaultValue={initial?.description ?? ""}
        placeholder="頁面說明（講座時間、講者、內容簡介…）"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <input
          name="lectureUrl"
          required
          defaultValue={initial?.lectureUrl ?? ""}
          placeholder="講座連結（https://…，只出現在信裡不露出在頁面）"
          className="w-96 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
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
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-medium">{webinar.title}</span>
        <span className="font-mono text-xs text-gray-400">/webinar/{webinar.slug}</span>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-bold">
          {webinar.requests.length} 人索取
        </span>
        {!webinar.isActive && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
            已關閉
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
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Email</th>
                <th className="px-2 py-1.5">寄送次數</th>
                <th className="px-2 py-1.5">首次索取</th>
                <th className="px-2 py-1.5">最後寄送</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {webinar.requests.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-2 py-1.5 font-mono text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5">{r.email}</td>
                  <td className="px-2 py-1.5 text-gray-500">{r.sentCount}</td>
                  <td className="px-2 py-1.5 text-gray-400">{formatDate(r.createdAt)}</td>
                  <td className="px-2 py-1.5 text-gray-400">
                    {r.lastSentAt ? formatDate(r.lastSentAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
