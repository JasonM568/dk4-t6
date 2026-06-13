import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { enrollmentSource, formatDate } from "@/lib/format";

export const metadata = { title: "觀看權限名單 — 管理後台" };

export default async function CourseMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, title: true, courseCode: true },
  });
  if (!course) notFound();

  const [enrollments, profiles] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
    }),
    listProfiles(),
  ]);
  const profById = new Map(profiles.map((p) => [p.id, p]));

  // 來源統計
  const counts = enrollments.reduce<Record<string, number>>((acc, e) => {
    const key = enrollmentSource(e.source, e.orderId).text;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl">
      <Link
        href={`/admin/courses/${id}`}
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 回課程編輯
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-bold">觀看權限名單</h1>
      <p className="mb-4 text-sm text-gray-500">
        {course.title}
        {course.courseCode ? `（${course.courseCode}）` : ""} — 共{" "}
        <span className="font-bold text-black">{enrollments.length}</span> 位會員可觀看
      </p>

      {/* 來源統計 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(counts).map(([label, n]) => (
          <span
            key={label}
            className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
          >
            {label}：{n}
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">會員</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3">開通時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {enrollments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  這堂課還沒有任何會員開通
                </td>
              </tr>
            )}
            {enrollments.map((e, i) => {
              const p = profById.get(e.userId);
              const src = enrollmentSource(e.source, e.orderId);
              return (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2">
                    {p?.display_name ?? (
                      <span className="text-gray-300">（查無會員資料）</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{p?.email ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${src.className}`}
                    >
                      {src.text}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400">
                    {formatDate(e.createdAt)}
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
