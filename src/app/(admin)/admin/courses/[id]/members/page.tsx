import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { enrollmentSource } from "@/lib/format";
import { createGroupFromCourseAction } from "@/actions/admin";
import { currentCanEdit } from "@/lib/auth/staff";
import { SubmitButton } from "@/components/admin/submit-button";
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

  const [enrollments, profiles, canEditNow] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
    }),
    listProfiles(),
    currentCanEdit(),
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

      {/* 整批匯出成名單群組（總教練唯讀時隱藏） */}
      {enrollments.length > 0 && canEditNow && (
        <form
          action={createGroupFromCourseAction.bind(null, id)}
          className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3"
        >
          <div>
            <label className="mb-1 block text-xs text-indigo-800">
              整批匯出成名單群組（供電子報群發）
            </label>
            <input
              name="newName"
              placeholder={`預設：${course.title} 觀看名單`}
              className="w-64 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <SubmitButton
            pendingText="匯出中…"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            匯出 {enrollments.length} 位成名單群組
          </SubmitButton>
        </form>
      )}

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
        canEdit={canEditNow}
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
