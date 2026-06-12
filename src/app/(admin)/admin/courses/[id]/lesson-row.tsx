"use client";

import { useState, useTransition } from "react";

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
  updateAction: (formData: FormData) => Promise<void>; // 已綁定 lessonId/courseId
  deleteAction: () => Promise<void>; // 已綁定 lessonId/courseId
};

/** 章節列：預設顯示模式，按「編輯」切換成行內表單 */
export function LessonRow({ lesson, updateAction, deleteAction }: LessonRowProps) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

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
          onClick={() => setEditing(true)}
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
        action={(formData) => {
          startTransition(async () => {
            await updateAction(formData);
            setEditing(false);
          });
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="w-14">
          <label className="mb-1 block text-xs text-gray-500">順序</label>
          <input
            name="order"
            type="number"
            defaultValue={lesson.order}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-gray-500">章節標題</label>
          <input
            name="title"
            required
            defaultValue={lesson.title}
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
            defaultValue={lesson.youtubeId}
            placeholder="可直接貼影片網址或嵌入碼"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-xs text-gray-500">秒數</label>
          <input
            name="durationSec"
            type="number"
            defaultValue={lesson.durationSec ?? ""}
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
            defaultValue={lesson.slideUrl ?? ""}
            placeholder="https://docs.google.com/presentation/…"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存"}
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
