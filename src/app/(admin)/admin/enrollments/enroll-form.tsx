"use client";

import { useActionState } from "react";
import {
  batchEnrollAction,
  createMissingAndEnrollAction,
  type BatchState,
} from "@/actions/admin";
import { BatchResultTable } from "@/components/admin/batch-result-table";

type CourseOption = { id: string; title: string };
type GroupOption = { id: string; name: string };

export function EnrollForm({
  courses,
  mailGroups = [],
}: {
  courses: CourseOption[];
  mailGroups?: GroupOption[];
}) {
  const [state, formAction, pending] = useActionState<BatchState, FormData>(
    batchEnrollAction,
    null,
  );
  // 查無會員 → 一鍵批次新增並開通
  const [fixState, fixAction, fixPending] = useActionState<
    BatchState,
    FormData
  >(createMissingAndEnrollAction, null);

  const notFound = state?.results?.filter((r) => r.status === "notfound") ?? [];
  // 還原成名單格式（email,姓名），交給同一套解析邏輯
  const notFoundList = notFound
    .map((r) => (r.name ? `${r.email},${r.name}` : r.email))
    .join("\n");

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
              "student1@example.com\nstudent2@example.com\n（也可貼「email,姓名」格式，查無會員時姓名會用於建立帳號）"
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            重複開通不會出錯（已有權限會自動略過）
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 p-4">
          <label className="mb-1 block text-sm font-medium">
            查無會員 → 直接建立帳號並開通（選填）
          </label>
          <input
            name="defaultPassword"
            minLength={6}
            placeholder="填一組預設密碼（至少 6 字元），例：hope2026"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            有填：名單裡查無的會員，這次就用這組密碼建立帳號並一併開通。
            留空：只開通既有會員，查無的會列在下方，再決定是否建立。
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 p-4">
          <label className="mb-1 block text-sm font-medium">
            同時加入寄信名單群組（選填）
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              name="groupId"
              defaultValue=""
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none sm:w-1/2"
            >
              <option value="">不加入群組</option>
              {mailGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  選既有：{g.name}
                </option>
              ))}
            </select>
            <input
              name="groupName"
              placeholder="或輸入新群組名稱，例：0625-AI初階"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none sm:w-1/2"
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            會把整份名單加進群組（重複自動略過）。填了新名稱以新名稱為準；
            名稱與既有群組相同則併入該群組。
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "處理中，請勿關閉頁面…" : "批次開通"}
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

      {/* 查無會員的後續處理：批次新增會員並直接開通（已註冊者不會被動到） */}
      {notFound.length > 0 && state?.courseId && !fixState?.summary && (
        <form
          action={fixAction}
          className="mt-6 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-medium text-amber-800">
            有 {notFound.length} 筆查無會員。可直接批次新增為會員（用下方預設密碼），
            並同時開通「{state.courseTitle}」觀看權限。
          </p>
          <input type="hidden" name="courseId" value={state.courseId} />
          <input type="hidden" name="list" value={notFoundList} />
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-amber-800">
                預設密碼（至少 6 字元）
              </label>
              <input
                name="defaultPassword"
                required
                minLength={6}
                placeholder="例：hope2026"
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={fixPending}
              onClick={(e) => {
                if (
                  !confirm(
                    `將建立 ${notFound.length} 個新會員帳號（密碼為你填的預設密碼），並開通「${state.courseTitle}」。\n\n若名單中有人在這期間已註冊，會自動跳過建立、直接開通權限。確定執行？`,
                  )
                )
                  e.preventDefault();
              }}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
            >
              {fixPending
                ? "處理中，請勿關閉頁面…"
                : `批次新增 ${notFound.length} 位會員並開通`}
            </button>
          </div>
          <p className="text-xs text-amber-700">
            建立後記得把帳號密碼通知學員（可用「群發通知」或「未登入會員批次重設密碼」頁的流程）
          </p>
        </form>
      )}

      {fixState?.error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {fixState.error}
        </div>
      )}
      {fixState?.summary && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {fixState.summary}
          </div>
          {fixState.results && <BatchResultTable results={fixState.results} />}
        </div>
      )}
    </>
  );
}
