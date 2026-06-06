import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { formatNT } from "@/lib/format";
import { computeDiscount } from "@/lib/membership/tier";
import { BuyButton } from "@/components/buy-button";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await prisma.course.findUnique({
    where: { slug },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  if (!course || !course.isPublished) notFound();

  const session = await auth();
  const userId = session?.user?.id;

  let isEnrolled = false;
  let discountPercent = 0;
  let tierName: string | null = null;

  if (userId) {
    const [enrollment, user] = await Promise.all([
      prisma.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        include: { currentTier: true },
      }),
    ]);
    isEnrolled = !!enrollment;
    discountPercent = user?.currentTier?.discountPercent ?? 0;
    tierName = user?.currentTier?.name ?? null;
  }

  const discount = computeDiscount(course.price, discountPercent);
  const finalPrice = course.price - discount;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="grid gap-8 lg:grid-cols-3">
        {/* 左：課程內容 */}
        <div className="lg:col-span-2">
          <div className="aspect-video overflow-hidden rounded-xl bg-gray-100">
            {course.coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={course.coverImage}
                alt={course.title}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <h1 className="mt-6 text-3xl font-bold">{course.title}</h1>
          <p className="mt-3 whitespace-pre-line text-gray-600">
            {course.description}
          </p>

          <h2 className="mt-8 mb-3 text-xl font-bold">課程章節</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {course.lessons.map((l, i) => (
              <li
                key={l.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="font-mono text-gray-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{l.title}</span>
                {l.durationSec && (
                  <span className="text-gray-400">
                    {Math.round(l.durationSec / 60)} 分鐘
                  </span>
                )}
                <span className="text-gray-300">🔒</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 右：購買區 */}
        <aside className="lg:col-span-1">
          <div className="sticky top-20 rounded-xl border border-gray-200 p-6">
            {discount > 0 ? (
              <div className="mb-4">
                <div className="text-sm text-gray-400 line-through">
                  {formatNT(course.price)}
                </div>
                <div className="text-3xl font-bold text-indigo-600">
                  {formatNT(finalPrice)}
                </div>
                <div className="mt-1 text-xs text-green-600">
                  {tierName} 專屬 {100 - discountPercent}% 折扣，省{" "}
                  {formatNT(discount)}
                </div>
              </div>
            ) : (
              <div className="mb-4 text-3xl font-bold text-indigo-600">
                {formatNT(course.price)}
              </div>
            )}

            <BuyButton
              courseId={course.id}
              isLoggedIn={!!userId}
              isEnrolled={isEnrolled}
            />

            <ul className="mt-4 space-y-1.5 text-sm text-gray-500">
              <li>✓ 購買後永久觀看</li>
              <li>✓ {course.lessons.length} 個章節</li>
              <li>✓ 支援信用卡 / ATM / 超商付款</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
