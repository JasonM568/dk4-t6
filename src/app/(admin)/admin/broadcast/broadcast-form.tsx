"use client";

import { useRef } from "react";
import { useActionState } from "react";
import type { BroadcastState } from "@/actions/admin";

type BroadcastFormProps = {
  courses: { id: string; title: string }[];
  memberCount: number;
  sendAction: (prev: BroadcastState, formData: FormData) => Promise<BroadcastState>;
};

/** 群發表單：先寄測試信給自己 → 確認後正式群發 */
export function BroadcastForm({ courses, memberCount, sendAction }: BroadcastFormProps) {
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(
    sendAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
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
          台灣時間；到點後 5 分鐘內寄出。排程後可在下方紀錄取消；寄送名單以寄出當下的會員為準
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
            const msg = when
              ? `確定排程在 ${when.replace("T", " ")} 群發給全部會員（約 ${memberCount} 位）嗎？\n\n建議先寄測試信確認版面無誤。`
              : `確定要立即群發給全部 ${memberCount} 位會員嗎？\n\n建議先寄測試信確認版面無誤。送出後無法收回。`;
            if (!confirm(msg)) {
              e.preventDefault();
            }
          }}
          className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "處理中…" : `② 正式群發（${memberCount} 位會員）`}
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
  );
}
