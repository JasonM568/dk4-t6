import Link from "next/link";
import { prisma } from "@/lib/db";
import { CourseCard } from "@/components/course-card";
import { TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { publicCourseWhere } from "@/lib/course-access";

export default async function HomePage() {
  const [courses, webinars] = await Promise.all([
    prisma.course.findMany({
      where: publicCourseWhere(),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 3,
    }),
    // 進行中的講座報名頁：首頁曝光導流（關閉報名即自動下架）
    prisma.webinar.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        dmImage: true,
      },
    }),
  ]);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-indigo-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            隨時隨地，開始你的學習旅程
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            {TIER_SYSTEM_ENABLED
              ? "精選線上課程，購買即可永久觀看。會員消費越多，享有越高折扣。"
              : "精選線上課程，購買即可永久觀看。"}
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              href="/courses"
              className="rounded-lg bg-black px-6 py-3 font-medium text-white transition hover:bg-gray-800"
            >
              瀏覽課程
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-gray-300 px-6 py-3 font-medium transition hover:bg-gray-50"
            >
              免費註冊
            </Link>
          </div>
        </div>
      </section>

      {/* 近期講座：進行中的講座報名頁（後台關閉報名即自動消失） */}
      {webinars.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="mb-6 text-center text-2xl font-bold">🎤 近期講座</h2>
          <div
            className={`grid gap-6 ${
              webinars.length === 1
                ? "mx-auto max-w-xl"
                : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {webinars.map((w) => (
              <Link
                key={w.id}
                href={`/webinar/${w.slug}`}
                className="group overflow-hidden rounded-2xl border border-gray-200 transition hover:border-gray-400 hover:shadow-md"
              >
                {w.dmImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.dmImage}
                    alt={`${w.title} 講座 DM`}
                    className="w-full object-cover"
                  />
                )}
                <div className="p-5">
                  <div className="text-lg font-bold group-hover:underline">
                    {w.title}
                  </div>
                  {w.description && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-gray-600">
                      {w.description}
                    </p>
                  )}
                  <div className="mt-4 inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition group-hover:bg-gray-800">
                    留 Email 索取講座連結 →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 會員等級說明（分級制度停用時整段隱藏） */}
      {TIER_SYSTEM_ENABLED && (
        <section className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="mb-6 text-center text-2xl font-bold">會員等級制度</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { name: "銅卡會員", cond: "註冊即享", discount: "原價" },
              { name: "銀卡會員", cond: "累積消費滿 NT$3,000", discount: "95 折" },
              { name: "金卡會員", cond: "累積消費滿 NT$10,000", discount: "9 折" },
            ].map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-gray-200 p-6 text-center"
              >
                <div className="text-lg font-bold">{t.name}</div>
                <div className="mt-2 text-sm text-gray-500">{t.cond}</div>
                <div className="mt-3 text-2xl font-bold text-indigo-600">
                  {t.discount}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 熱門課程 */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">熱門課程</h2>
          <Link href="/courses" className="text-sm text-indigo-600 underline">
            查看全部
          </Link>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
