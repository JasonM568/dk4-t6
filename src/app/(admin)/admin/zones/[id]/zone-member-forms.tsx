"use client";

import { useActionState, useState } from "react";
import type { ZoneActionState } from "@/actions/admin";

type BoundAction = (
  prev: ZoneActionState,
  formData: FormData,
) => Promise<ZoneActionState>;

function StateMessages({ state }: { state: ZoneActionState }) {
  return (
    <>
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
    </>
  );
}

/** 單筆新增專區會員 */
export function AddZoneMemberForm({ addAction }: { addAction: BoundAction }) {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    addAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="member@example.com"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">姓名（選填）</label>
          <input
            name="name"
            placeholder="王小明"
            className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "加入中…" : "加入會員"}
        </button>
      </div>
      <StateMessages state={state} />
    </form>
  );
}

/** 批次匯入專區會員 */
export function ImportZoneMembersForm({
  importAction,
}: {
  importAction: BoundAction;
}) {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    importAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="list"
        rows={5}
        placeholder={"一行一筆，可「email,姓名」格式\nmember1@example.com,王小明\nmember2@example.com"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
      />
      <p className="text-xs text-gray-400">
        一次最多 500 筆；重複的 email 自動略過（可放心重貼整份名單）。
        尚未註冊的 email 也可先加入，對方之後註冊即自動生效。
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            匯入中，請勿關閉頁面…
          </span>
        ) : (
          "批次匯入"
        )}
      </button>
      <StateMessages state={state} />
    </form>
  );
}

/** 一鍵複製邀請連結 */
export function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-sm text-indigo-600 hover:underline"
    >
      {copied ? "✓ 已複製" : "複製邀請連結"}
    </button>
  );
}
