"use client";

import { useActionState } from "react";
import type { BulkPasswordState } from "@/actions/admin";

type Row = {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  enrollmentCount: number;
};

type PasswordFormProps = {
  rows: Row[];
  setAction: (
    prev: BulkPasswordState,
    formData: FormData,
  ) => Promise<BulkPasswordState>;
};

/** 從未登入會員清單：勾選 + 批次重設密碼 */
export function PasswordForm({ rows, setAction }: PasswordFormProps) {
  const [state, formAction, pending] = useActionState<BulkPasswordState, FormData>(
    setAction,
    null,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const checked = form.querySelectorAll(
          'input[name="userIds"]:checked',
        ).length;
        if (
          !confirm(
            `確定為勾選的 ${checked} 位會員重設密碼？\n\n會覆蓋他們原本的密碼（從未登入的會員不受影響）。`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  defaultChecked
                  onChange={(e) => {
                    e.currentTarget
                      .closest("table")
                      ?.querySelectorAll<HTMLInputElement>(
                        'input[name="userIds"]',
                      )
                      .forEach((cb) => {
                        cb.checked = e.currentTarget.checked;
                      });
                  }}
                  title="全選/全不選"
                />
              </th>
              <th className="px-4 py-3">會員</th>
              <th className="px-4 py-3">建立時間</th>
              <th className="px-4 py-3">課程權限</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-gray-400">
                  目前沒有從未登入的會員 🎉
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    name="userIds"
                    value={r.id}
                    defaultChecked
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.name ?? "—"}</div>
                  <div className="text-xs text-gray-400">{r.email}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(r.createdAt).toLocaleString("zh-TW")}
                </td>
                <td className="px-4 py-3">
                  {r.enrollmentCount > 0 ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      {r.enrollmentCount} 門課
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              要設定的密碼（至少 6 字元）
            </label>
            <input
              name="password"
              required
              placeholder="例：hope2026"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "設定中…" : "為勾選會員重設密碼"}
          </button>
          {state?.success && (
            <span className="text-sm text-green-600">✓ {state.success}</span>
          )}
          {state?.error && (
            <span className="text-sm text-red-600">{state.error}</span>
          )}
        </div>
      )}
    </form>
  );
}
