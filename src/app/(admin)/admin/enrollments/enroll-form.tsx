"use client";

import { useActionState } from "react";
import { batchEnrollAction, type BatchState } from "@/actions/admin";
import { BatchResultTable } from "@/components/admin/batch-result-table";

type CourseOption = { id: string; title: string };

export function EnrollForm({ courses }: { courses: CourseOption[] }) {
  const [state, formAction, pending] = useActionState<BatchState, FormData>(
    batchEnrollAction,
    null,
  );

  return (
    <>
      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">課程</label>
          <select
            name="courseId"
            required
            defaultValue=""
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="" disabled>
              選擇要開通的課程
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            學員 email 名單（一行一位）
          </label>
          <textarea
            name="list"
            rows={10}
            required
            placeholder={
              "student1@example.com\nstudent2@example.com\n（也可貼「email,姓名」格式，姓名會自動忽略）"
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            重複開通不會出錯（已有權限會自動略過）；查無會員的請先到「會員匯入」建帳號
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "開通中，請勿關閉頁面…" : "批次開通"}
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
        </div>
      )}
    </>
  );
}
