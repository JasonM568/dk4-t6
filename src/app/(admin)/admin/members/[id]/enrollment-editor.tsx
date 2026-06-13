"use client";

import { useActionState, useTransition } from "react";
import type { EnrollmentEditState } from "@/actions/admin";
import { enrollmentSource } from "@/lib/format";

type EnrolledRow = {
  courseId: string;
  title: string;
  enrolledAt: string;
  fromOrder: boolean;
  source: string | null;
  orderId: string | null;
};

type AvailableCourse = {
  id: string;
  title: string;
  isPublished: boolean;
};

type EnrollmentEditorProps = {
  enrolled: EnrolledRow[];
  available: AvailableCourse[]; // 尚未開通的課程
  grantAction: (
    prev: EnrollmentEditState,
    formData: FormData,
  ) => Promise<EnrollmentEditState>; // 已綁定 userId
  revokeActions: Record<string, () => Promise<void>>; // courseId → 已綁定的移除 action
};

/** 方案 A：已開通清單（逐筆移除）+ 下拉選單新增 */
export function EnrollmentEditor({
  enrolled,
  available,
  grantAction,
  revokeActions,
}: EnrollmentEditorProps) {
  const [state, formAction, granting] = useActionState<
    EnrollmentEditState,
    FormData
  >(grantAction, null);
  const [revoking, startRevoke] = useTransition();

  return (
    <div>
      {/* 已開通清單 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">課程</th>
              <th className="px-4 py-3">開通時間</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {enrolled.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-gray-400">
                  尚未開通任何課程
                </td>
              </tr>
            )}
            {enrolled.map((e) => (
              <tr key={e.courseId}>
                <td className="px-4 py-3 font-medium">{e.title}</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(e.enrolledAt).toLocaleString("zh-TW")}
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const s = enrollmentSource(e.source, e.orderId);
                    return (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${s.className}`}
                      >
                        {s.text}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={revoking}
                    onClick={() => {
                      const warn = e.fromOrder
                        ? `「${e.title}」是學員付費購買的課程，確定要移除觀看權限？`
                        : `確定移除「${e.title}」的觀看權限？`;
                      if (confirm(warn)) {
                        startRevoke(() => revokeActions[e.courseId]());
                      }
                    }}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新增權限 */}
      <form action={formAction} className="mt-3 flex items-center gap-2">
        <select
          name="courseId"
          required
          defaultValue=""
          disabled={available.length === 0}
          className="min-w-60 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="" disabled>
            {available.length === 0 ? "已開通全部課程" : "選擇要開通的課程"}
          </option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.isPublished ? "" : "（未上架）"}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={granting || available.length === 0}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {granting ? "開通中…" : "開通"}
        </button>
        {state?.success && (
          <span className="text-sm text-green-600">✓ {state.success}</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
      </form>
    </div>
  );
}
