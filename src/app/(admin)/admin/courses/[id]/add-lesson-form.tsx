"use client";

import { useActionState, useEffect, useState } from "react";
import type { LessonFormState } from "@/actions/admin";

type AddLessonFormProps = {
  action: (prev: LessonFormState, formData: FormData) => Promise<LessonFormState>; // 已綁定 courseId
  nextOrder: number;
};

/**
 * 新增章節表單（受控）：失敗時保留使用者填的內容並顯示原因。
 * 有內容尚未送出時標 data-unsaved-lesson，讓上方「儲存變更」能提醒——
 * 兩個表單互相獨立，曾有人填了章節卻按「儲存變更」，連結就這樣消失了。
 */
export function AddLessonForm({ action, nextOrder }: AddLessonFormProps) {
  const [state, formAction, pending] = useActionState<LessonFormState, FormData>(
    action,
    null,
  );
  const [title, setTitle] = useState("");
  const [youtubeId, setYoutubeId] = useState("");
  const [order, setOrder] = useState(String(nextOrder));
  const [durationSec, setDurationSec] = useState("");
  const [slideUrl, setSlideUrl] = useState("");

  // 新增成功才清空；順序帶下一號
  useEffect(() => {
    if (state?.ok) {
      setTitle("");
      setYoutubeId("");
      setDurationSec("");
      setSlideUrl("");
    }
  }, [state]);
  useEffect(() => setOrder(String(nextOrder)), [nextOrder]);

  const dirty = title.trim() !== "" || youtubeId.trim() !== "";

  return (
    <form
      id="add-lesson-form"
      action={formAction}
      data-unsaved-lesson={dirty ? "true" : undefined}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-gray-300 p-4"
    >
      <div>
        <label className="mb-1 block text-xs text-gray-500">章節標題</label>
        <input
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">
          YouTube 網址或影片 ID
        </label>
        <input
          name="youtubeId"
          required
          value={youtubeId}
          onChange={(e) => setYoutubeId(e.target.value)}
          placeholder="可直接貼影片網址或嵌入碼"
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="w-16">
        <label className="mb-1 block text-xs text-gray-500">順序</label>
        <input
          name="order"
          type="number"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-xs text-gray-500">秒數</label>
        <input
          name="durationSec"
          type="number"
          value={durationSec}
          onChange={(e) => setDurationSec(e.target.value)}
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
          value={slideUrl}
          onChange={(e) => setSlideUrl(e.target.value)}
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
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "新增中…" : "新增章節"}
      </button>
      {dirty && !pending && (
        <span className="text-xs text-amber-700">← 填好後請按這顆，章節才會存進去</span>
      )}
    </form>
  );
}
