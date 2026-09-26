"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { LessonFormState } from "@/actions/admin";

type Lesson = {
  id: string;
  title: string;
  youtubeId: string;
  slideUrl: string | null;
  order: number;
  durationSec: number | null;
};

type LessonRowProps = {
  lesson: Lesson;
  updateAction: (prev: LessonFormState, formData: FormData) => Promise<LessonFormState>; // 已綁定 lessonId/courseId
  deleteAction: () => Promise<void>; // 已綁定 lessonId/courseId
};

/** 章節列：預設顯示模式，按「編輯」切換成行內表單 */
export function LessonRow({ lesson, updateAction, deleteAction }: LessonRowProps) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, formAction, saving] = useActionState<LessonFormState, FormData>(
    updateAction,
    null,
  );
  // 受控欄位：存檔失敗時保留使用者改的內容
  const [form, setForm] = useState(() => toForm(lesson));
  const set = (k: keyof ReturnType<typeof toForm>) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // 存檔成功才收起編輯列（失敗留在原地顯示原因）
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  function startEditing() {
    setForm(toForm(lesson));
    setEditing(true);
  }

  if (!editing) {
    return (
      <li className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="font-mono text-gray-400">{lesson.order}</span>
        <span className="flex-1">{lesson.title}</span>
        <span className="max-w-40 truncate font-mono text-xs text-gray-400">
          {lesson.youtubeId}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className="text-indigo-600 hover:underline"
        >
          編輯
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm(`確定刪除章節「${lesson.title}」？`)) {
              startTransition(() => deleteAction());
            }
          }}
          className="text-red-600 hover:underline disabled:opacity-50"
        >
          刪除
        </button>
      </li>
    );
  }

  return (
    <li className="px-4 py-3">
      <form
        action={formAction}
        data-unsaved-lesson="true"
        className="flex flex-wrap items-end gap-2"
      >
        <div className="w-14">
          <label className="mb-1 block text-xs text-gray-500">順序</label>
          <input
            name="order"
            type="number"
            value={form.order}
            onChange={set("order")}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-gray-500">章節標題</label>
          <input
            name="title"
            required
            value={form.title}
            onChange={set("title")}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-44 flex-1">
          <label className="mb-1 block text-xs text-gray-500">
            YouTube 網址或影片 ID
          </label>
          <input
            name="youtubeId"
            required
            value={form.youtubeId}
            onChange={set("youtubeId")}
            placeholder="可直接貼影片網址或嵌入碼"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-xs text-gray-500">秒數</label>
          <input
            name="durationSec"
            type="number"
            value={form.durationSec}
            onChange={set("durationSec")}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="w-full">
          <label className="mb-1 block text-xs text-gray-500">
            線上簡報網址（選填，貼 Google Slides / Canva 分享連結即可）
          </label>
          <input
            name="slideUrl"
            type="url"
            value={form.slideUrl}
            onChange={set("slideUrl")}
            placeholder="https://docs.google.com/presentation/…"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        {state?.error && (
          <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          取消
        </button>
      </form>
    </li>
  );
}

function toForm(lesson: Lesson) {
  return {
    order: String(lesson.order),
    title: lesson.title,
    youtubeId: lesson.youtubeId,
    durationSec: lesson.durationSec == null ? "" : String(lesson.durationSec),
    slideUrl: lesson.slideUrl ?? "",
  };
}
