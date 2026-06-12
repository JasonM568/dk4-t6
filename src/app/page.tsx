import Link from "next/link";
import { prisma } from "@/lib/db";
import { CourseCard } from "@/components/course-card";
import { TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";

export default async function HomePage() {
  const courses = await prisma.course.findMany({
    where: { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 3,
  });

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
