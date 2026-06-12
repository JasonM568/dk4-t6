"use client";

import { useActionState } from "react";
import type { EnrollmentEditState } from "@/actions/admin";

type CourseRow = {
  id: string;
  title: string;
  isPublished: boolean;
  // 已有權限時帶入的資訊（未開通為 null）
  enrolledAt: string | null;
  fromOrder: boolean;
};

type EnrollmentEditorProps = {
  courses: CourseRow[];
  saveAction: (
    prev: EnrollmentEditState,
    formData: FormData,
  ) => Promise<EnrollmentEditState>; // 已綁定 userId
};

/** 會員觀看權限編輯：勾選 = 開放觀看，取消 = 移除權限，按儲存生效 */
export function EnrollmentEditor({ courses, saveAction }: EnrollmentEditorProps) {
  const [state, formAction, pending] = useActionState<EnrollmentEditState, FormData>(
    saveAction,
    null,
  );

  return (
    <form action={formAction}>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="w-12 px-4 py-3">開放</th>
              <th className="px-4 py-3">課程</th>
              <th className="px-4 py-3">開通時間</th>
              <th className="px-4 py-3">來源</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {courses.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-gray-400">
                  尚無任何課程
                </td>
              </tr>
            )}
            {courses.map((c) => (
              <tr key={c.id} className={c.enrolledAt ? "" : "text-gray-500"}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    name="courseIds"
                    value={c.id}
                    defaultChecked={!!c.enrolledAt}
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">{c.title}</span>
                  {!c.isPublished && (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      未上架
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {c.enrolledAt
                    ? new Date(c.enrolledAt).toLocaleString("zh-TW")
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {c.enrolledAt ? (
                    c.fromOrder ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                        購買
                      </span>
                    ) : (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        手動開通
                      </span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存權限變更"}
        </button>
        {state?.success && (
          <span className="text-sm text-green-600">✓ {state.success}</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
        <span className="text-xs text-gray-400">
          取消勾選會移除觀看權限（包含學員自己購買的課程），請小心操作
        </span>
      </div>
    </form>
  );
}
