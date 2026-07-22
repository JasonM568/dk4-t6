import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { CourseTable } from "./course-table";

export const metadata = { title: "課程管理" };

export default async function AdminCoursesPage() {
  const [courses, canEditNow] = await Promise.all([
    prisma.course.findMany({
      include: {
        _count: { select: { lessons: true, enrollments: true } },
        group: { select: { name: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    currentCanEdit(),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">課程管理</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canEditNow
              ? "拖曳 ⠿ 調整順序，或用 ⤒ 置頂、↑↓ 微調"
              : "唯讀檢視（總教練）"}
          </p>
        </div>
        {canEditNow && (
          <Link
            href="/admin/courses/new"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
          >
            + 新增課程
          </Link>
        )}
      </div>

      <CourseTable
        canEdit={canEditNow}
        courses={courses.map((c) => ({
          id: c.id,
          title: c.title,
          slug: c.slug,
          price: c.price,
          lessons: c._count.lessons,
          enrollments: c._count.enrollments,
          isPublished: c.isPublished,
          zoneName: c.group?.name ?? null,
        }))}
      />
    </div>
  );
}
