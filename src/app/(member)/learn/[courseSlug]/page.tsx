import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { extractYoutubeId } from "@/lib/youtube";
import { toSlideEmbedUrl } from "@/lib/embed";
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
    include: {
      lessons: { orderBy: { order: "asc" } },
      materials: { orderBy: { createdAt: "asc" } },
    },
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

          {/* 線上簡報（章節有設定才顯示） */}
          {current.slideUrl && (
            <div className="mt-6">
              <h3 className="mb-2 font-medium">📑 本章簡報</h3>
              <div className="aspect-video overflow-hidden rounded-xl border border-gray-200">
                <iframe
                  key={`slide-${current.id}`}
                  className="h-full w-full"
                  src={toSlideEmbedUrl(current.slideUrl)}
                  title={`${current.title} 簡報`}
                  allowFullScreen
                />
              </div>
            </div>
          )}
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

          {/* 課程講義下載 */}
          {course.materials.length > 0 && (
            <div className="mt-6 rounded-xl border border-gray-200">
              <div className="border-b border-gray-100 px-4 py-3 font-medium">
                課程講義（{course.materials.length}）
              </div>
              <ul className="divide-y divide-gray-100">
                {course.materials.map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-gray-50"
                    >
                      <span>📄</span>
                      <span className="flex-1">{m.title}</span>
                      <span className="text-xs text-indigo-600">下載</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
