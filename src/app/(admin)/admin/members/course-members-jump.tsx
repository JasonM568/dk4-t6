"use client";

import { useRouter } from "next/navigation";

/** 課程觀看名單捷徑：選課程直接跳轉到該課程的觀看權限名單頁
 *（那裡可查看/新增/移除名單、匯出或同步成寄信群組） */
export function CourseMembersJump({
  courses,
}: {
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  if (courses.length === 0) return null;

  return (
    <select
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) router.push(`/admin/courses/${e.target.value}/members`);
      }}
      aria-label="查課程觀看名單"
      className="max-w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-black focus:outline-none"
    >
      <option value="" disabled>
        📋 查課程觀看名單…
      </option>
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}
