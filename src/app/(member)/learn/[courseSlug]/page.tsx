import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { extractYoutubeId } from "@/lib/youtube";
import { prisma } from "@/lib/db";

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseSlug: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const { courseSlug } = await params;
  const { lesson } = await searchParams;

  const user = await getAuthUser();
  if (!user) redirect("/login");
  const userId = user.id;

  const course = await prisma.course.findUnique({
    where: { slug: courseSlug },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  if (!course) notFound();

  // ── 權限閘門：以 Enrollment 為唯一真實來源，未購買者一律導回詳情頁 ──
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
  });
  if (!enrollment) redirect(`/courses/${courseSlug}`);

  if (course.lessons.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-gray-500">
        此課程尚未上架章節。
      </div>
    );
  }

  const current =
    course.lessons.find((l) => l.id === lesson) ?? course.lessons[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/my-courses" className="text-sm text-gray-500 hover:text-black">
        ← 我的課程
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold">{course.title}</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 播放器 */}
        <div className="lg:col-span-2">
          <div className="aspect-video overflow-hidden rounded-xl bg-black">
            {/* 容錯：舊資料若存成完整網址/嵌入碼，播放時自動抽出 ID */}
            {(() => {
              const videoId =
                extractYoutubeId(current.youtubeId) ?? current.youtubeId;
              return (
                <iframe
                  key={current.id}
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${videoId}?rel=0`}
                  title={current.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              );
            })()}
          </div>
          <h2 className="mt-4 text-xl font-bold">{current.title}</h2>
        </div>

        {/* 章節列表 */}
        <aside className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200">
            <div className="border-b border-gray-100 px-4 py-3 font-medium">
              課程章節（{course.lessons.length}）
            </div>
            <ul className="divide-y divide-gray-100">
              {course.lessons.map((l, i) => {
                const active = l.id === current.id;
                return (
                  <li key={l.id}>
                    <Link
                      href={`/learn/${courseSlug}?lesson=${l.id}`}
                      className={`flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-gray-50 ${
                        active ? "bg-indigo-50 font-medium text-indigo-700" : ""
                      }`}
                    >
                      <span className="font-mono text-gray-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex-1">{l.title}</span>
                      {active && <span>▶</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
