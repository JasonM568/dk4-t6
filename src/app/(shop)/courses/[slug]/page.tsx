import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";

// 永遠抓最新開通狀態（剛被開通，課程頁的按鈕立刻變「觀看影片」）
export const dynamic = "force-dynamic";
import { getProfileRole } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/auth/role";
import { canViewGroupCourse, canWatchCourse } from "@/lib/course-access";
import { formatNT } from "@/lib/format";
import { computeDiscount, TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { BuyButton } from "@/components/buy-button";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      lessons: { orderBy: { order: "asc" } },
      group: { select: { slug: true, name: true } },
    },
  });
  if (!course || !course.isPublished) notFound();

  // 可選登入：未登入也能看課程詳情，只是沒有會員折扣
  const user = await getAuthUser();
  const userId = user?.id;

  // 企業專區課程：非專區會員（也非後台幹部）導去專區擋牆頁
  if (course.groupId && course.group) {
    if (!(await canViewGroupCourse(course, user))) {
      redirect(`/zone/${course.group.slug}`);
    }
  }

  let isEnrolled = false;
  let discountPercent = 0;
  let tierName: string | null = null;

  if (userId) {
    const [canWatch, stats] = await Promise.all([
      // Enrollment ∨ 專區限時開放且為會員（與觀看頁閘門同一判斷）
      canWatchCourse(course, { id: userId, email: user?.email ?? null }),
      // 分級制度停用時不查等級，一律顯示原價
      TIER_SYSTEM_ENABLED
        ? prisma.memberStats.findUnique({
            where: { userId },
            include: { currentTier: true },
          })
        : Promise.resolve(null),
    ]);
    isEnrolled = canWatch;
    discountPercent = stats?.currentTier?.discountPercent ?? 0;
    tierName = stats?.currentTier?.name ?? null;

    // 管理員免購買視同已開通（按鈕顯示「前往上課」，觀看頁閘門同步放行）
    if (!isEnrolled) {
      isEnrolled = isAdminRole(await getProfileRole(userId));
    }
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

          {/* 課程介紹圖 */}
          {course.introImages.length > 0 && (
            <div className="mt-6 space-y-4">
              {course.introImages.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={course.title}
                  className="w-full rounded-xl border border-gray-100"
                />
              ))}
            </div>
          )}

          <h2 className="mt-8 mb-3 text-xl font-bold">課程章節</h2>
          {/* 已開通：章節直接連到觀看頁對應單元；未開通維持鎖頭 */}
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {course.lessons.map((l, i) => {
              const row = (
                <>
                  <span className="font-mono text-gray-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1">{l.title}</span>
                  {l.durationSec && (
                    <span className="text-gray-400">
                      {Math.round(l.durationSec / 60)} 分鐘
                    </span>
                  )}
                  {isEnrolled ? (
                    <span className="font-medium text-indigo-600">▶ 觀看</span>
                  ) : (
                    <span className="text-gray-300">🔒</span>
                  )}
                </>
              );
              return (
                <li key={l.id} className="text-sm">
                  {isEnrolled ? (
                    <Link
                      href={`/learn/${course.slug}?lesson=${l.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-50"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* 右：購買區（企業專區課程改為開通狀態卡，不販售） */}
        <aside className="lg:col-span-1">
          <div className="sticky top-20 rounded-xl border border-gray-200 p-6">
            {course.groupId && course.group ? (
              <div>
                <div className="mb-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                  {course.group.name}
                </div>
                {isEnrolled ? (
                  <Link
                    href={`/learn/${course.slug}`}
                    className="block w-full rounded-lg bg-black py-3 text-center font-medium text-white transition hover:bg-gray-800"
                  >
                    前往上課
                  </Link>
                ) : (
                  <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                    本課程觀看權限由管理員開通，尚未開通請聯繫專區窗口。
                  </div>
                )}
                <ul className="mt-4 space-y-1.5 text-sm text-gray-500">
                  <li>✓ {course.lessons.length} 個章節</li>
                  <li>✓ 專區會員專屬課程</li>
                </ul>
              </div>
            ) : discount > 0 ? (
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
              <div className="mb-4">
                {course.listPrice != null && course.listPrice > course.price && (
                  <div className="text-sm text-gray-400">
                    建議售價{" "}
                    <span className="line-through">
                      {formatNT(course.listPrice)}
                    </span>
                  </div>
                )}
                <div className="text-3xl font-bold text-indigo-600">
                  {formatNT(course.price)}
                </div>
                {course.listPrice != null && course.listPrice > course.price && (
                  <div className="mt-1 text-xs text-green-600">
                    限時優惠，省 {formatNT(course.listPrice - course.price)}
                  </div>
                )}
              </div>
            )}

            {!course.groupId && (
              <>
                <BuyButton
                  courseId={course.id}
                  courseSlug={course.slug}
                  isLoggedIn={!!userId}
                  isEnrolled={isEnrolled}
                />

                <ul className="mt-4 space-y-1.5 text-sm text-gray-500">
                  <li>✓ 購買後永久觀看</li>
                  <li>✓ {course.lessons.length} 個章節</li>
                  <li>✓ 支援信用卡 / ATM / 超商付款</li>
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
