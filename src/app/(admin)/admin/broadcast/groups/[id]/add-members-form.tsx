"use client";

import { useActionState } from "react";
import type { GroupAddState } from "@/actions/admin";

/** 加入名單：貼上文字或上傳 CSV，送出後回報加入/略過筆數 */
export function AddMembersForm({
  addAction,
}: {
  addAction: (prev: GroupAddState, formData: FormData) => Promise<GroupAddState>;
}) {
  const [state, formAction, pending] = useActionState<GroupAddState, FormData>(
    addAction,
    null,
  );

  return (
    <form
      action={formAction}
      className="mb-6 space-y-3 rounded-xl border border-dashed border-gray-300 p-4"
    >
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">加入名單</label>
        <a
          href="/templates/mail-list-template.csv"
          download="名單匯入範本.csv"
          className="text-xs text-indigo-600 hover:underline"
        >
          ⬇ 下載 CSV 範本
        </a>
      </div>

      <textarea
        name="list"
        rows={4}
        placeholder={"直接貼上：一行一筆，可「email,姓名」格式\nstudent1@example.com,王小明\nstudent2@example.com"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">或上傳 CSV：</span>
        <input
          type="file"
          name="csv"
          accept=".csv,text/csv"
          className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
      </div>
      <p className="text-xs text-gray-400">
        CSV 欄位：email、姓名（姓名可空白）；可貼文字和上傳檔案同時使用，重複的 email 自動略過
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            名單加入中，請勿關閉頁面…
          </span>
        ) : (
          "加入名單"
        )}
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
