"use client";

import { useActionState } from "react";
import { importMembersAction, type BatchState } from "@/actions/admin";
import { BatchResultTable } from "@/components/admin/batch-result-table";

export default function ImportMembersPage() {
  const [state, formAction, pending] = useActionState<BatchState, FormData>(
    importMembersAction,
    null,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">會員批次匯入</h1>
      <p className="mt-2 text-sm text-gray-500">
        為尚未註冊的學員批次建立帳號。建立後學員即可用 email + 密碼登入本站與
        hope 站（同一組帳號）。已存在的會員會自動略過，不會被改密碼。
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            學員名單（一行一位）
          </label>
          <textarea
            name="list"
            rows={10}
            required
            placeholder={
              "格式：email,姓名,密碼（姓名與密碼可省略，用逗號或 Tab 分隔）\n" +
              "student1@example.com,王小明\n" +
              "student2@example.com,李小華,abc12345\n" +
              "student3@example.com"
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            可直接從 Excel 複製貼上（Tab 分隔也支援）；# 開頭的行會略過
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            預設密碼（名單未填密碼時套用）
          </label>
          <input
            type="text"
            name="defaultPassword"
            placeholder="至少 6 字元，例如 hope2026"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            記得把帳號密碼通知學員；之後設好寄信服務，學員也可自行用「忘記密碼」重設
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "匯入中，請勿關閉頁面…" : "開始匯入"}
        </button>
      </form>

      {state?.error && (
        <div className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {state?.summary && (
        <div className="mt-6 space-y-3">
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm font-medium">
            {state.summary}
          </div>
          {state.results && <BatchResultTable results={state.results} />}
          <p className="text-sm text-gray-500">
            下一步：到「批次開通」為這批學員開通課程觀看權限 →{" "}
            <a href="/admin/enrollments" className="text-indigo-600 underline">
              前往批次開通
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
