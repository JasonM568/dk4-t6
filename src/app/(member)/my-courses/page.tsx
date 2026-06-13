import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";

// 永遠抓最新開通狀態（避免學員登入後才被開通、卻看到舊快取沒有新課程）
export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export const metadata = { title: "我的課程" };

export default async function MyCoursesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const enrollments = await prisma.enrollment.findMany({
    where: { userId: user.id },
    include: { course: { include: { _count: { select: { lessons: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold">我的課程</h1>

      {enrollments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-500">你還沒有購買任何課程。</p>
          <Link
            href="/courses"
            className="mt-4 inline-block rounded-lg bg-black px-5 py-2.5 font-medium text-white"
          >
            去逛逛課程
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((e) => (
            <Link
              key={e.id}
              href={`/learn/${e.course.slug}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 transition hover:shadow-lg"
            >
              <div className="aspect-video overflow-hidden bg-gray-100">
                {e.course.coverImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.course.coverImage}
                    alt={e.course.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-bold">{e.course.title}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {e.course._count.lessons} 個章節
                </p>
                <span className="mt-3 text-sm font-medium text-indigo-600">
                  開始觀看 →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
