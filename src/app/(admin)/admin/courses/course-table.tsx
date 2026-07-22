"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  moveCourse,
  pinCourseToTop,
  reorderCoursesAction,
  duplicateCourse,
} from "@/actions/admin";
import { formatNT } from "@/lib/format";

export type CourseRow = {
  id: string;
  title: string;
  slug: string;
  price: number;
  lessons: number;
  enrollments: number;
  isPublished: boolean;
  zoneName: string | null; // 所屬企業專區名稱（null = 一般公開課程）
};

// 拖曳排序用原生 HTML5 drag & drop（桌機）；觸控裝置用 ↑↓/置頂 按鈕備援。
// 拖曳過程先改本地 state 即時預覽，放開才呼叫 server action 寫入。
export function CourseTable({
  courses,
  canEdit = true,
}: {
  courses: CourseRow[];
  canEdit?: boolean; // 總教練(唯讀)為 false：隱藏排序/複製/編輯
}) {
  const [items, setItems] = useState(courses);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // server 重新整理後同步（revalidate 會帶新 props 進來）
  const [prevCourses, setPrevCourses] = useState(courses);
  if (courses !== prevCourses) {
    setPrevCourses(courses);
    setItems(courses);
  }

  function handleDragEnter(overId: string) {
    if (!dragId || dragId === overId) return;
    setItems((cur) => {
      const from = cur.findIndex((c) => c.id === dragId);
      const to = cur.findIndex((c) => c.id === overId);
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function handleDragEnd() {
    if (!dragId) return;
    setDragId(null);
    startTransition(() => reorderCoursesAction(items.map((c) => c.id)));
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            {canEdit && <th className="px-4 py-3">順序</th>}
            <th className="px-4 py-3">標題</th>
            <th className="px-4 py-3">售價</th>
            <th className="px-4 py-3">章節</th>
            <th className="px-4 py-3">已售</th>
            <th className="px-4 py-3">狀態</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody
          className={`divide-y divide-gray-100 ${isPending ? "opacity-60" : ""}`}
        >
          {items.map((c, i) => (
            <tr
              key={c.id}
              onDragEnter={() => canEdit && handleDragEnter(c.id)}
              onDragOver={(e) => e.preventDefault()}
              className={dragId === c.id ? "bg-indigo-50" : ""}
            >
              {canEdit && (
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(c.id);
                    }}
                    onDragEnd={handleDragEnd}
                    title="拖曳調整順序"
                    className="cursor-grab select-none rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-50 active:cursor-grabbing"
                  >
                    ⠿
                  </span>
                  <button
                    onClick={() =>
                      startTransition(() => pinCourseToTop(c.id))
                    }
                    disabled={i === 0 || isPending}
                    title="置頂"
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                  >
                    ⤒
                  </button>
                  <button
                    onClick={() =>
                      startTransition(() => moveCourse(c.id, "up"))
                    }
                    disabled={i === 0 || isPending}
                    title="上移"
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() =>
                      startTransition(() => moveCourse(c.id, "down"))
                    }
                    disabled={i === items.length - 1 || isPending}
                    title="下移"
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </td>
              )}
              <td className="px-4 py-3">
                <div className="font-medium">
                  {c.title}
                  {c.zoneName && (
                    <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-normal text-indigo-700">
                      {c.zoneName}
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-gray-400">{c.slug}</div>
              </td>
              <td className="px-4 py-3">{formatNT(c.price)}</td>
              <td className="px-4 py-3">{c.lessons}</td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/courses/${c.id}/members`}
                  className="text-indigo-600 hover:underline"
                  title="查看觀看權限名單"
                >
                  {c.enrollments} 人
                </Link>
              </td>
              <td className="px-4 py-3">
                {c.isPublished ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    已上架
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    未上架
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-3">
                  {canEdit && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `要複製「${c.title}」嗎？\n章節、講義、分類會一併複製，複本為未上架狀態。`,
                          )
                        )
                          startTransition(() => duplicateCourse(c.id));
                      }}
                      disabled={isPending}
                      className="text-gray-500 hover:underline disabled:opacity-50"
                    >
                      複製
                    </button>
                  )}
                  <Link
                    href={
                      canEdit
                        ? `/admin/courses/${c.id}`
                        : `/admin/courses/${c.id}/members`
                    }
                    className="text-indigo-600 hover:underline"
                  >
                    {canEdit ? "編輯" : "觀看名單"}
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
