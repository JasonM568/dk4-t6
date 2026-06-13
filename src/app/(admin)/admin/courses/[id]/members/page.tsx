import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { enrollmentSource } from "@/lib/format";
import { CourseMembersManager } from "./members-manager";

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

      <CourseMembersManager
        courseId={course.id}
        members={enrollments.map((e) => {
          const p = profById.get(e.userId);
          return {
            userId: e.userId,
            name: p?.display_name ?? null,
            email: p?.email ?? null,
            source: e.source,
            orderId: e.orderId,
            createdAt: e.createdAt.toISOString(),
          };
        })}
      />
    </div>
  );
}
