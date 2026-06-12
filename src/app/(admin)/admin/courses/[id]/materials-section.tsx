"use client";

import { useActionState, useTransition } from "react";
import type { MaterialState } from "@/actions/admin";

type Material = { id: string; title: string; url: string };

type MaterialsSectionProps = {
  materials: Material[];
  addAction: (prev: MaterialState, formData: FormData) => Promise<MaterialState>; // 已綁定 courseId
  deleteActions: Record<string, () => Promise<void>>; // materialId → 已綁定的刪除 action
};

/** 課程講義管理：列表 + 上傳/外部網址新增 */
export function MaterialsSection({
  materials,
  addAction,
  deleteActions,
}: MaterialsSectionProps) {
  const [state, formAction, pending] = useActionState<MaterialState, FormData>(
    addAction,
    null,
  );
  const [deleting, startDelete] = useTransition();

  return (
    <div className="mt-10 max-w-2xl">
      <h2 className="mb-3 text-lg font-bold">課程講義</h2>
      <p className="mb-3 text-sm text-gray-500">
        學員可在課程觀看頁下載。支援 PDF、PPT、Word、Excel、ZIP（20MB 內），或填外部網址（如雲端硬碟分享連結）。
      </p>

      <ul className="mb-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {materials.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-400">尚無講義</li>
        )}
        {materials.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="text-gray-400">📄</span>
            <span className="flex-1">{m.title}</span>
            <a
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 hover:underline"
            >
              預覽
            </a>
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                if (confirm(`確定刪除講義「${m.title}」？`)) {
                  startDelete(() => deleteActions[m.id]());
                }
              }}
              className="text-red-600 hover:underline disabled:opacity-50"
            >
              刪除
            </button>
          </li>
        ))}
      </ul>

      <form
        action={formAction}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-gray-500">講義名稱</label>
          <input
            name="title"
            required
            placeholder="例：第一章講義 PDF"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-gray-500">上傳檔案</label>
          <input
            name="file"
            type="file"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.zip"
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-gray-500">
            或外部網址（有上傳檔案時以檔案為準）
          </label>
          <input
            name="url"
            type="url"
            placeholder="https://…"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "上傳中…" : "新增講義"}
        </button>
        {state?.error && (
          <p className="w-full text-sm text-red-600">{state.error}</p>
        )}
      </form>
    </div>
  );
}
