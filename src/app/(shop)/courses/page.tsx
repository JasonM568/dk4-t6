import { prisma } from "@/lib/db";
import { CourseCard } from "@/components/course-card";

export const metadata = { title: "所有課程 — 希望學院學習平台" };

export default async function CoursesPage() {
  const courses = await prisma.course.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold">所有課程</h1>
      {courses.length === 0 ? (
        <p className="text-gray-500">目前還沒有課程。</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      )}
    </div>
  );
}
