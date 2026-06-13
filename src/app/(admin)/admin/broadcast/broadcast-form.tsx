"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  saveBroadcastListToGroupAction,
  type BroadcastState,
} from "@/actions/admin";

type GroupOption = { id: string; name: string; memberCount: number };

type BroadcastFormProps = {
  courses: { id: string; title: string }[];
  groups: GroupOption[];
  memberCount: number;
  sendAction: (prev: BroadcastState, formData: FormData) => Promise<BroadcastState>;
};

/** 電子報群發表單：選發送對象（全部會員/名單群組/手動名單）→ 寄測試信 → 正式群發/排程 */
export function BroadcastForm({
  courses,
  groups,
  memberCount,
  sendAction,
}: BroadcastFormProps) {
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(
    sendAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [audience, setAudience] = useState<"all" | "group" | "manual">("all");

  const audienceDesc = () => {
    if (audience === "all") return `全部 ${memberCount} 位會員`;
    if (audience === "group") {
      const sel = (
        formRef.current?.elements.namedItem("groupId") as HTMLSelectElement | null
      )?.selectedOptions[0]?.textContent;
      return `名單群組「${sel ?? ""}」`;
    }
    return "手動貼入的名單";
  };

  return (
    <>
      <form ref={formRef} action={formAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">主旨</label>
          <input
            name="subject"
            required
            placeholder="例：新課程上架｜內在豐盛工作坊開放報名"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">內文</label>
          <textarea
            name="body"
            required
            rows={8}
            placeholder={"親愛的學員您好：\n\n希望學院推出新課程⋯⋯\n\n（空一行 = 分段）"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            純文字即可，空一行會自動分段；信件會套用希望學院品牌版型（紅底 LOGO 頁首＋金邊卡片）
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            關聯課程（選填，信中會帶課程卡片與「查看課程」按鈕）
          </label>
          <select
            name="courseId"
            defaultValue=""
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="">不帶課程</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        {/* 發送對象 */}
        <fieldset className="rounded-xl border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">發送對象</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="all"
                checked={audience === "all"}
                onChange={() => setAudience("all")}
              />
              全部會員（{memberCount} 位）
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="group"
                checked={audience === "group"}
                onChange={() => setAudience("group")}
              />
              名單群組
              {groups.length === 0 && (
                <span className="text-xs text-gray-400">
                  （尚無群組，先到
                  <Link
                    href="/admin/broadcast/groups"
                    className="text-indigo-600 underline"
                  >
                    名單群組
                  </Link>
                  建立）
                </span>
              )}
            </label>
            {audience === "group" && groups.length > 0 && (
              <select
                name="groupId"
                required
                defaultValue=""
                className="ml-6 w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              >
                <option value="" disabled>
                  選擇群組
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.memberCount} 筆）
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="manual"
                checked={audience === "manual"}
                onChange={() => setAudience("manual")}
              />
              手動貼入名單
            </label>
            {audience === "manual" && (
              <div className="ml-6">
                <textarea
                  name="manualList"
                  required
                  rows={6}
                  placeholder={"student1@example.com,王小明\nstudent2@example.com\n（一行一筆，可附姓名）"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
                />
                <p className="mt-1 text-xs text-amber-600">
                  💡 寄出後可把這批名單建立成群組，下次直接選用（寄出後下方會再提醒）
                </p>
              </div>
            )}
          </div>
        </fieldset>

        <div>
          <label className="mb-1 block text-sm font-medium">
            預設發送時間（選填，留空 = 按下群發立即寄出）
          </label>
          <input
            name="scheduledAt"
            type="datetime-local"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            台灣時間；到點後 5 分鐘內寄出。排程後可在下方紀錄取消；全部會員/群組名單以寄出當下為準
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            name="mode"
            value="test"
            disabled={pending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 disabled:opacity-50"
          >
            {pending ? "處理中…" : "① 寄測試信給我"}
          </button>
          <button
            type="submit"
            name="mode"
            value="all"
            disabled={pending}
            onClick={(e) => {
              const when = (
                formRef.current?.elements.namedItem(
                  "scheduledAt",
                ) as HTMLInputElement | null
              )?.value;
              const target = audienceDesc();
              const msg = when
                ? `確定排程在 ${when.replace("T", " ")} 群發給「${target}」嗎？\n\n建議先寄測試信確認版面無誤。`
                : `確定要立即群發給「${target}」嗎？\n\n建議先寄測試信確認版面無誤。送出後無法收回。`;
              if (!confirm(msg)) {
                e.preventDefault();
              }
            }}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "處理中…" : "② 正式群發"}
          </button>
        </div>

        {state?.success && (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            ✓ {state.success}
          </div>
        )}
        {state?.error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        )}
      </form>

      {/* 手動名單寄出/排程後的提醒：是否將此名單建立群組？ */}
      {state?.broadcastId && (state.manualCount ?? 0) > 0 && (
        <SaveListPrompt
          broadcastId={state.broadcastId}
          manualCount={state.manualCount!}
          groups={groups}
        />
      )}
    </>
  );
}

/** 「是否將此名單建立群組？」：建新群組或併入既有群組 */
function SaveListPrompt({
  broadcastId,
  manualCount,
  groups,
}: {
  broadcastId: string;
  manualCount: number;
  groups: GroupOption[];
}) {
  return (
    <form
      action={saveBroadcastListToGroupAction.bind(null, broadcastId)}
      className="mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-sm font-medium text-amber-800">
        💾 是否將此名單建立群組？這批 {manualCount} 筆名單可以存起來，下次群發直接選用。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-amber-800">
            建立新群組
          </label>
          <input
            name="newName"
            placeholder="新群組名稱"
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        {groups.length > 0 && (
          <>
            <span className="pb-2 text-xs text-amber-700">或加入既有群組</span>
            <select
              name="groupId"
              defaultValue=""
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
            >
              <option value="">— 選擇群組 —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（{g.memberCount} 筆）
                </option>
              ))}
            </select>
          </>
        )}
        <button className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700">
          存入群組
        </button>
      </div>
      <p className="text-xs text-amber-700">
        填了新群組名稱以新群組為準；存入後會跳轉到該群組頁面。不需要的話直接忽略即可。
      </p>
    </form>
  );
}
