"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  saveBroadcastListToGroupAction,
  type BroadcastState,
} from "@/actions/admin";
import { SubmitButton } from "@/components/admin/submit-button";

type GroupOption = { id: string; name: string; memberCount: number };
type MemberOption = { email: string; name: string };

export type BroadcastFormDefaults = {
  subject: string;
  body: string;
  courseId: string;
  audience: "all" | "group" | "manual";
  groupId: string;
  manualList: string;
  scheduledAt: string; // datetime-local 格式（台北時間），空字串 = 未排程
};

/** 跟進信模式：發送對象鎖定為來源群發的開信/未開信/點擊名單，寄出當下才解析 */
export type BroadcastFollowUp = {
  sourceId: string;
  sourceSubject: string;
  filter: "OPENED" | "NOT_OPENED" | "CLICKED";
  filterLabel: string; // 開信者 / 未開信者 / 點擊者
  estimatedCount: number; // 目前符合人數（僅供參考，實際以寄出當下為準）
};

type BroadcastFormProps = {
  courses: { id: string; title: string }[];
  groups: GroupOption[];
  memberCount: number;
  members: MemberOption[]; // 會員清單（「選取會員」勾選用）
  sendAction: (prev: BroadcastState, formData: FormData) => Promise<BroadcastState>;
  defaultValues?: BroadcastFormDefaults; // 編輯排程/草稿時帶入
  followUp?: BroadcastFollowUp; // 跟進信模式：取代發送對象區塊
};

/** 電子報群發表單：選發送對象（全部會員/名單群組/手動名單）→ 寄測試信 → 正式群發/排程/存草稿 */
export function BroadcastForm({
  courses,
  groups,
  memberCount,
  members,
  sendAction,
  defaultValues,
  followUp,
}: BroadcastFormProps) {
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(
    sendAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [audience, setAudience] = useState<
    "all" | "group" | "manual" | "members"
  >(defaultValues?.audience ?? "all");
  const [picked, setPicked] = useState<Map<string, MemberOption>>(new Map());

  // 把變數插入內文游標處（textarea 為非受控，直接改 value 即可送出）
  const insertVar = (token: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    const pos = start + token.length;
    el.focus();
    el.setSelectionRange(pos, pos);
  };

  const audienceDesc = () => {
    if (followUp)
      return `跟進：${followUp.filterLabel}（來源：${followUp.sourceSubject}）`;
    if (audience === "all") return `全部 ${memberCount} 位會員`;
    if (audience === "group") {
      const sel = (
        formRef.current?.elements.namedItem("groupId") as HTMLSelectElement | null
      )?.selectedOptions[0]?.textContent;
      return `名單群組「${sel ?? ""}」`;
    }
    if (audience === "members") return `勾選的 ${picked.size} 位會員`;
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
            defaultValue={defaultValues?.subject}
            placeholder="例：新課程上架｜內在豐盛工作坊開放報名"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-sm font-medium">內文</label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">插入變數：</span>
              <button
                type="button"
                onClick={() => insertVar("{email}")}
                className="rounded border border-gray-300 px-2 py-0.5 font-mono text-xs hover:bg-gray-50"
              >
                {"{email}"}
              </button>
              <button
                type="button"
                onClick={() => insertVar("{name}")}
                className="rounded border border-gray-300 px-2 py-0.5 font-mono text-xs hover:bg-gray-50"
              >
                {"{name}"}
              </button>
            </div>
          </div>
          <textarea
            ref={bodyRef}
            name="body"
            required
            defaultValue={defaultValues?.body}
            rows={8}
            placeholder={"親愛的學員您好：\n\n希望學院推出新課程⋯⋯\n\n您的帳號：{email}\n預設密碼：a12345\n\n（空一行 = 分段）"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            純文字即可，空一行會自動分段；信件會套用希望學院品牌版型（紅底 LOGO 頁首＋金邊卡片）。
            <br />
            可用變數：<span className="font-mono">{"{email}"}</span>＝收件人 email、
            <span className="font-mono">{"{name}"}</span>＝姓名，寄出時自動帶入每位收件人
            （沒有姓名的人 <span className="font-mono">{"{name}"}</span> 會留空）。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            關聯課程（選填，信中會帶課程卡片與「查看課程」按鈕）
          </label>
          <select
            name="courseId"
            defaultValue={defaultValues?.courseId ?? ""}
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

        {/* 發送對象：跟進信模式鎖定為來源群發的成效名單，不顯示 radio */}
        {followUp ? (
          <fieldset className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4">
            <legend className="px-1 text-sm font-medium text-cyan-800">
              發送對象（跟進信）
            </legend>
            <input type="hidden" name="audience" value="followup" />
            <input type="hidden" name="sourceBroadcastId" value={followUp.sourceId} />
            <input type="hidden" name="followUpFilter" value={followUp.filter} />
            <p className="text-sm text-cyan-900">
              📬 跟進對象：<span className="font-medium">{followUp.filterLabel}</span>
              （來源：{followUp.sourceSubject}）
            </p>
            <p className="mt-1 text-xs text-cyan-700">
              目前約 {followUp.estimatedCount} 人符合；名單在「寄出當下」才解析，
              晚{followUp.filter === "NOT_OPENED" ? "開信的人會自動排除" : "開信/點擊的人也會自動納入"}，
              退訂與退信者一律不寄。
            </p>
          </fieldset>
        ) : (
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
                defaultValue={defaultValues?.groupId ?? ""}
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
                  defaultValue={defaultValues?.manualList}
                  rows={6}
                  placeholder={"student1@example.com,王小明\nstudent2@example.com\n（一行一筆，可附姓名）"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
                />
                <p className="mt-1 text-xs text-amber-600">
                  💡 寄出後可把這批名單建立成群組，下次直接選用（寄出後下方會再提醒）
                </p>
              </div>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value="members"
                checked={audience === "members"}
                onChange={() => setAudience("members")}
              />
              選取會員
              <span className="text-xs text-gray-400">
                （從會員清單搜尋勾選，適合補寄或個案通知）
              </span>
            </label>
            {audience === "members" && (
              <MemberPicker members={members} picked={picked} setPicked={setPicked} />
            )}
          </div>
        </fieldset>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            預設發送時間（選填，留空 = 按下群發立即寄出）
          </label>
          <input
            name="scheduledAt"
            type="datetime-local"
            defaultValue={defaultValues?.scheduledAt}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            {followUp
              ? "台灣時間；到點後 5 分鐘內寄出。跟進名單於寄出當下解析，越晚寄涵蓋越多晚開信者；排程後可在下方紀錄取消"
              : "台灣時間；到點後 5 分鐘內寄出。排程後可在下方紀錄取消；全部會員/群組名單以寄出當下為準"}
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
          <button
            type="submit"
            name="mode"
            value="draft"
            formNoValidate
            disabled={pending}
            className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            title="只需填主旨即可儲存，之後可在寄送紀錄繼續編輯"
          >
            {pending ? "處理中…" : "存草稿"}
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

const PICKER_MAX_SHOWN = 30;

/** 選取會員：搜尋會員清單 → 勾選 → 以隱藏欄位（email,姓名 行格式）隨表單送出 */
function MemberPicker({
  members,
  picked,
  setPicked,
}: {
  members: MemberOption[];
  picked: Map<string, MemberOption>;
  setPicked: (next: Map<string, MemberOption>) => void;
}) {
  const [q, setQ] = useState("");
  const keyword = q.trim().toLowerCase();
  const matched = keyword
    ? members.filter(
        (m) =>
          m.email.toLowerCase().includes(keyword) ||
          m.name.toLowerCase().includes(keyword),
      )
    : members;
  const shown = matched.slice(0, PICKER_MAX_SHOWN);

  const toggle = (m: MemberOption) => {
    const next = new Map(picked);
    if (next.has(m.email)) next.delete(m.email);
    else next.set(m.email, m);
    setPicked(next);
  };

  return (
    <div className="ml-6 space-y-2">
      <input
        type="hidden"
        name="memberList"
        value={[...picked.values()]
          .map((m) => (m.name ? `${m.email},${m.name}` : m.email))
          .join("\n")}
      />

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">已勾選 {picked.size} 位：</span>
          {[...picked.values()].map((m) => (
            <button
              key={m.email}
              type="button"
              onClick={() => toggle(m)}
              title="點擊移除"
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
            >
              {m.name || m.email}
              <span className="text-indigo-400">✕</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPicked(new Map())}
            className="text-xs text-gray-400 hover:text-red-600 hover:underline"
          >
            全部清除
          </button>
        </div>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋 email 或姓名…"
        className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />

      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {shown.length === 0 && (
          <p className="px-3 py-3 text-sm text-gray-400">
            沒有符合「{q.trim()}」的會員
          </p>
        )}
        {shown.map((m) => (
          <label
            key={m.email}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            <input
              type="checkbox"
              checked={picked.has(m.email)}
              onChange={() => toggle(m)}
            />
            <span className="font-mono">{m.email}</span>
            {m.name && <span className="text-gray-500">{m.name}</span>}
          </label>
        ))}
        {matched.length > PICKER_MAX_SHOWN && (
          <p className="px-3 py-2 text-xs text-gray-400">
            還有 {matched.length - PICKER_MAX_SHOWN} 筆未顯示，輸入關鍵字縮小範圍
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400">
        名單來源＝已註冊會員（同會員管理頁）；寄出後同樣可存成群組
      </p>
    </div>
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
        <SubmitButton
          pendingText="存入中…"
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          存入群組
        </SubmitButton>
      </div>
      <p className="text-xs text-amber-700">
        填了新群組名稱以新群組為準；存入後會跳轉到該群組頁面。不需要的話直接忽略即可。
      </p>
    </form>
  );
}
