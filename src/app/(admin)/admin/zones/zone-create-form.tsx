"use client";

import { useActionState } from "react";
import { createZoneAction, type ZoneActionState } from "@/actions/admin";

export function ZoneCreateForm() {
  const [state, formAction, pending] = useActionState<ZoneActionState, FormData>(
    createZoneAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4"
    >
      <div className="font-medium">＋ 建立新專區</div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">專區名稱</label>
          <input
            name="name"
            required
            placeholder="例：世華會學習專區"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">
            網址代稱（小寫英數，前台網址 /zone/代稱）
          </label>
          <input
            name="slug"
            required
            placeholder="例：shihua"
            pattern="[a-z0-9\-]+"
            className="w-48 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "建立中…" : "建立專區"}
      </button>
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
