import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { isGroupMember } from "@/lib/course-access";
import { currentStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin } from "@/lib/auth/role";
import { isPathEnabled } from "@/lib/site-pages";
import { CourseCard } from "@/components/course-card";
import { redeemInviteAction } from "@/actions/zone";
import { RedeemInviteForm } from "./redeem-form";

// 會籍/開通狀態即時生效（後台剛加人、剛開通，重新整理就要看到）
export const dynamic = "force-dynamic";

export default async function ZonePage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const zone = await prisma.courseGroup.findUnique({
    where: { slug: groupSlug },
  });
  if (!zone || !zone.isActive) notFound();
  // 後台「分頁管理」關閉時整區 404（與三分頁行為一致）
  if (!(await isPathEnabled(`/zone/${groupSlug}`))) notFound();

  const user = await getAuthUser();
  const [isMember, staffRole] = await Promise.all([
    isGroupMember(zone.id, user?.email ?? null),
    currentStaffRole(),
  ]);
  const isStaff = canAccessAdmin(staffRole);

  // 專區主題配色（後台可設定）：主色用於標題區/按鈕，輔助色用於漸層/徽章
  const primary = zone.themePrimary ?? "#4f46e5";
  const accent = zone.themeAccent ?? zone.themePrimary ?? "#312e81";

  // ── 非會員（也非後台幹部）：擋牆 ──
  if (!isMember && !isStaff) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl text-white"
          style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
        >
          🔒
        </div>
        <h1 className="mt-4 text-3xl font-bold" style={{ color: primary }}>
          {zone.name}
        </h1>
        <p className="mt-3 text-gray-600">此專區僅限{zone.name.replace(/學習?專區$/, "")}會員使用。</p>
        {zone.wallText && (
          <p className="mx-auto mt-2 max-w-md whitespace-pre-line text-sm text-gray-500">
            {zone.wallText}
          </p>
        )}

        <div className="mx-auto mt-8 max-w-sm rounded-xl border border-gray-200 p-6 text-left">
          {user ? (
            <>
              <div className="mb-3 text-sm font-medium">有邀請碼嗎？</div>
              <RedeemInviteForm
                redeemAction={redeemInviteAction.bind(null, zone.slug)}
                buttonColor={primary}
              />
            </>
          ) : (
            <div className="space-y-3 text-center">
              <Link
                href="/login"
                className="block w-full rounded-lg py-3 font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: primary }}
              >
                會員登入
              </Link>
              <p className="text-sm text-gray-500">
                還沒有帳號？請使用專屬邀請連結註冊，或先{" "}
                <Link href="/register" className="text-indigo-600 underline">
                  註冊
                </Link>{" "}
                後回到此頁輸入邀請碼
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 會員/後台幹部：專區課程列表 ──
  const courses = await prisma.course.findMany({
    where: { groupId: zone.id, isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  // 標記每堂課的開通狀態（觀看權限仍以 Enrollment 為準）
  const enrolledIds = new Set(
    user
      ? (
          await prisma.enrollment.findMany({
            where: { userId: user.id, courseId: { in: courses.map((c) => c.id) } },
            select: { courseId: true },
          })
        ).map((e) => e.courseId)
      : [],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {isStaff && !isMember && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          你正以管理身分預覽此專區（一般會員需在專區名單內才看得到這一頁）。
        </div>
      )}
      {/* 專區主視覺標題區（配色由後台設定） */}
      <div
        className="mb-8 rounded-2xl px-6 py-10 text-white sm:px-10"
        style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
      >
        <h1 className="text-3xl font-bold sm:text-4xl">{zone.name}</h1>
        <p className="mt-2 text-sm text-white/85">
          專區課程由管理員開通觀看權限；已開通的課程點進去即可上課。
        </p>
      </div>
      {courses.length === 0 ? (
        <p className="text-gray-500">課程籌備中，敬請期待。</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              hidePrice
              badge={enrolledIds.has(c.id) ? "✓ 已開通" : "尚未開通"}
              badgeStyle={
                enrolledIds.has(c.id)
                  ? { backgroundColor: primary, color: "#fff" }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
