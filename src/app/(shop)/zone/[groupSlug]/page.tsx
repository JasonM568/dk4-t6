import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { isGroupMember, groupOpenAccessActive } from "@/lib/course-access";
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

  // 整頁背景：主題色 → 輔助色漸層（卡片維持白底）
  const pageBg = {
    background: `linear-gradient(160deg, ${primary}, ${accent})`,
  };

  // ── 非會員（也非後台幹部）：擋牆 ──
  if (!isMember && !isStaff) {
    return (
      <div className="flex-1" style={pageBg}>
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/40 bg-white/15 text-3xl">
            🔒
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white">{zone.name}</h1>
          <p className="mt-3 text-white/90">
            此專區僅限{zone.name.replace(/學習?專區$/, "")}會員使用。
          </p>
          {zone.wallText && (
            <p className="mx-auto mt-2 max-w-md whitespace-pre-line text-sm text-white/80">
              {zone.wallText}
            </p>
          )}

          <div className="mx-auto mt-8 max-w-sm rounded-xl bg-white p-6 text-left shadow-lg">
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
                  <Link
                    href="/register"
                    className="underline"
                    style={{ color: primary }}
                  >
                    註冊
                  </Link>{" "}
                  後回到此頁輸入邀請碼
                </p>
              </div>
            )}
          </div>
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
    <div className="flex-1" style={pageBg}>
      <div className="mx-auto max-w-6xl px-4 py-12">
        {isStaff && !isMember && (
          <div className="mb-6 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            你正以管理身分預覽此專區（一般會員需在專區名單內才看得到這一頁）。
          </div>
        )}
        {/* 標題直接落在漸層底上（配色由後台設定） */}
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          {zone.name}
        </h1>
        <p className="mt-2 mb-8 text-sm text-white/85">
          專區課程由管理員開通觀看權限；已開通的課程點進去即可上課。
        </p>
        {courses.length === 0 ? (
          <p className="text-white/85">課程籌備中，敬請期待。</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => {
              // 限時免開通期間，會員未逐課開通也視同可看
              const canWatch =
                enrolledIds.has(c.id) || groupOpenAccessActive(c);
              return (
                <CourseCard
                  key={c.id}
                  course={c}
                  hidePrice
                  badge={
                    enrolledIds.has(c.id)
                      ? "✓ 已開通"
                      : canWatch
                        ? "✓ 開放觀看中"
                        : "尚未開通"
                  }
                  badgeStyle={
                    canWatch
                      ? { backgroundColor: primary, color: "#fff" }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
