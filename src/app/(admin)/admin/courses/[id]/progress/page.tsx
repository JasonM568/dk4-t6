import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { formatDuration, formatDate } from "@/lib/format";

export const metadata = { title: "觀看時長 — 管理後台" };

export default async function CourseProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      courseCode: true,
      lessons: { select: { id: true }, orderBy: { order: "asc" } },
    },
  });
  if (!course) notFound();

  const [progress, profiles] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { courseId: id },
      orderBy: { updatedAt: "desc" },
    }),
    listProfiles(),
  ]);
  const profById = new Map(profiles.map((p) => [p.id, p]));
  const lessonCount = course.lessons.length;

  // 依會員彙總：總實看秒數、已看章節數（watchedSec>0）、最後觀看時間
  type Row = {
    userId: string;
    totalSec: number;
    lessonsWatched: number;
    lastWatchedAt: Date;
  };
  const byUser = new Map<string, Row>();
  for (const p of progress) {
    const row = byUser.get(p.userId) ?? {
      userId: p.userId,
      totalSec: 0,
      lessonsWatched: 0,
      lastWatchedAt: p.updatedAt,
    };
    row.totalSec += p.watchedSec;
    if (p.watchedSec > 0) row.lessonsWatched += 1;
    if (p.updatedAt > row.lastWatchedAt) row.lastWatchedAt = p.updatedAt;
    byUser.set(p.userId, row);
  }
  const rows = [...byUser.values()].sort((a, b) => b.totalSec - a.totalSec);

  return (
    <div className="max-w-4xl">
      <Link
        href={`/admin/courses/${id}`}
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 回課程編輯
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">觀看時長</h1>
      <p className="mb-4 text-sm text-gray-500">
        {course.title}
        {course.courseCode ? `（${course.courseCode}）` : ""} — 共{" "}
        <span className="font-bold text-black">{lessonCount}</span> 個章節、
        <span className="font-bold text-black">{rows.length}</span> 位會員有觀看紀錄
      </p>

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">會員</th>
              <th className="px-4 py-3">累積觀看時長</th>
              <th className="px-4 py-3">已看章節</th>
              <th className="px-4 py-3">最後觀看</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-gray-400">
                  尚無觀看紀錄
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const p = profById.get(r.userId);
              return (
                <tr key={r.userId}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/members/${r.userId}`}
                      className="font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {p?.display_name ?? p?.email ?? r.userId.slice(0, 8)}
                    </Link>
                    {p?.email && (
                      <div className="text-xs text-gray-400">{p.email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {formatDuration(r.totalSec)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.lessonsWatched}
                    {lessonCount ? ` / ${lessonCount}` : ""} 章
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(r.lastWatchedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
