import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProfiles, listAuthMeta, countProfiles } from "@/lib/supabase/admin";
import { updateTier, createGroupFromCourseAction } from "@/actions/admin";
import { enrollmentSource, formatDate } from "@/lib/format";
import { currentCanEdit } from "@/lib/auth/staff";
import { SubmitButton } from "@/components/admin/submit-button";
import { MemberTable } from "./member-table";

export const metadata = { title: "會員管理" };

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    group?: string | string[];
    course?: string;
  }>;
}) {
  const { q, group, course } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const selectedCourseId = (course ?? "").trim();
  const selectedGroupIds = (Array.isArray(group) ? group : group ? [group] : []).filter(Boolean);

  // 會員身分在 Supabase public.profiles（唯讀），消費統計在 course.MemberStats，
  // 應用層以 userId 拼裝（不開 multiSchema、不對 public schema 做 join 寫入）
  const [profiles, statsList, tiers, mailGroups, passwords, authMeta, totalCount] =
    await Promise.all([
      listProfiles(),
      prisma.memberStats.findMany({ include: { currentTier: true } }),
      prisma.membershipTier.findMany({ orderBy: { level: "asc" } }),
      prisma.mailGroup.findMany({
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.memberPassword.findMany(),
      listAuthMeta(),
      // B5：「共 N 位」用真實總數（head:true 只取 count），不受列表筆數影響
      countProfiles(),
    ]);

  // 依課程查觀看名單（選課程才查）
  const allCourses = await prisma.course.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, title: true },
  });
  const canEditNow = await currentCanEdit();
  const selectedCourse = allCourses.find((c) => c.id === selectedCourseId) ?? null;
  const courseEnrollments = selectedCourse
    ? await prisma.enrollment.findMany({
        where: { courseId: selectedCourseId },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const profByIdForCourse = new Map(profiles.map((p) => [p.id, p]));

  // 勾選名單群組 → 取出群組內 email 集合過濾會員
  const groupEmails =
    selectedGroupIds.length > 0
      ? new Set(
          (
            await prisma.mailGroupMember.findMany({
              where: { groupId: { in: selectedGroupIds } },
              select: { email: true },
            })
          ).map((m) => m.email.toLowerCase()),
        )
      : null;

  const statsByUserId = new Map(statsList.map((s) => [s.userId, s]));
  const passwordByUserId = new Map(passwords.map((p) => [p.userId, p.password]));

  // MemberStats 是 lazy upsert（首次付款才建立），沒有統計的會員以 0 顯示
  const all = profiles
    .map((p) => {
      const stats = statsByUserId.get(p.id);
      return {
        ...p,
        currentTier: stats?.currentTier ?? null,
        totalSpent: stats?.totalSpent ?? 0,
        coursesBought: stats?.coursesBought ?? 0,
        initialPassword: passwordByUserId.get(p.id) ?? null,
        lastSignInAt: authMeta.get(p.id)?.lastSignInAt ?? null,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const hasFilter = !!query || !!groupEmails;
  // 搜尋（姓名/email 子字串）與群組過濾可並用；無條件時顯示全部會員（不再截斷前 100）
  const members = hasFilter
    ? all.filter((m) => {
        const email = (m.email ?? "").toLowerCase();
        if (groupEmails && !groupEmails.has(email)) return false;
        if (
          query &&
          !(m.display_name ?? "").toLowerCase().includes(query) &&
          !email.includes(query)
        )
          return false;
        return true;
      })
    : all;

  return (
    <div className="space-y-10">
      {/* 等級規則設定 */}
      <section>
        <h1 className="mb-1 text-2xl font-bold">等級規則</h1>
        <p className="mb-4 text-sm text-gray-500">
          調整門檻與折扣後，新的付款會依新規則重算等級。
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {tiers.map((t) => (
            <form
              key={t.id}
              action={updateTier.bind(null, t.id)}
              className="rounded-xl border border-gray-200 p-4"
            >
              <div className="mb-3 font-bold">
                {t.name}（Lv.{t.level}）
              </div>
              <label className="mb-1 block text-xs text-gray-500">
                累積消費門檻
              </label>
              <input
                name="minTotalSpent"
                type="number"
                defaultValue={t.minTotalSpent}
                disabled={!canEditNow}
                className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
              />
              <label className="mb-1 block text-xs text-gray-500">
                折扣 %（0-100）
              </label>
              <input
                name="discountPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={t.discountPercent}
                disabled={!canEditNow}
                className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
              />
              {canEditNow && (
                <button className="w-full rounded-lg bg-black py-1.5 text-sm font-medium text-white">
                  儲存
                </button>
              )}
            </form>
          ))}
        </div>
      </section>

      {/* 依課程查觀看名單 + 匯出名單群組 */}
      <section>
        <h2 className="mb-1 text-2xl font-bold">依課程查觀看名單</h2>
        <p className="mb-4 text-sm text-gray-500">
          選一堂課，列出有觀看權限的會員，可整批匯出成名單群組（供電子報群發）。
        </p>
        <form action="/admin/members" className="mb-4 flex flex-wrap gap-2">
          <select
            name="course"
            defaultValue={selectedCourseId}
            className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          >
            <option value="">選擇課程…</option>
            {allCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800">
            查詢觀看名單
          </button>
        </form>

        {selectedCourse && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                「{selectedCourse.title}」共{" "}
                <span className="font-bold">{courseEnrollments.length}</span>{" "}
                位可觀看
              </p>
              {courseEnrollments.length > 0 && canEditNow && (
                <form
                  action={createGroupFromCourseAction.bind(null, selectedCourseId)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input
                    name="newName"
                    placeholder={`${selectedCourse.title} 觀看名單`}
                    className="w-56 rounded-lg border border-indigo-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                  />
                  <SubmitButton
                    pendingText="匯出中…"
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
                  >
                    匯出成名單群組
                  </SubmitButton>
                </form>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">會員</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">來源</th>
                    <th className="px-4 py-3">開通時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {courseEnrollments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                        這堂課還沒有任何會員開通
                      </td>
                    </tr>
                  )}
                  {courseEnrollments.map((e, i) => {
                    const p = profByIdForCourse.get(e.userId);
                    const src = enrollmentSource(e.source, e.orderId);
                    return (
                      <tr key={e.id}>
                        <td className="px-4 py-2 font-mono text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2">
                          {p?.display_name ?? (
                            <span className="text-gray-300">（查無會員資料）</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500">{p?.email ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${src.className}`}
                          >
                            {src.text}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-400">
                          {formatDate(e.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 會員列表 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {hasFilter
              ? `篩選結果：${members.length} 筆`
              : `會員列表（全部 ${totalCount} 位）`}
          </h2>
          <Link
            href="/admin/members/inactive"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          >
            🔑 未登入會員（批次設密碼）
          </Link>
        </div>

        {/* 搜尋 + 名單群組篩選：GET query，免 client JS */}
        <form
          action="/admin/members"
          className="mb-4 space-y-3 rounded-xl border border-gray-200 p-4"
        >
          <div className="flex gap-2">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="輸入姓名或 email 搜尋"
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
            <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800">
              套用
            </button>
            {hasFilter && (
              <Link
                href="/admin/members"
                className="flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              >
                清除
              </Link>
            )}
          </div>
          {mailGroups.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs text-gray-500">
                名單群組篩選（可複選，只顯示群組名單內的會員）：
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {mailGroups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="group"
                      value={g.id}
                      defaultChecked={selectedGroupIds.includes(g.id)}
                    />
                    {g.name}
                    <span className="text-xs text-gray-400">
                      （{g._count.members}）
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </form>

        <MemberTable
          canEdit={canEditNow}
          courses={allCourses}
          members={members.map((m) => ({
            id: m.id,
            displayName: m.display_name,
            email: m.email,
            role: m.role,
            tierName: m.currentTier?.name ?? null,
            totalSpent: m.totalSpent,
            coursesBought: m.coursesBought,
            initialPassword: m.initialPassword,
            lastSignInAt: m.lastSignInAt,
          }))}
          groups={mailGroups.map((g) => ({ id: g.id, name: g.name }))}
        />
        <p className="mt-2 text-xs text-gray-400">
          「初始密碼」為管理員建帳號／批次重設時設定的密碼備查；學員若自行修改過密碼，此欄不會更新。自行註冊的會員無此紀錄。勾選會員可加入名單群組；「重設密碼」會覆蓋該會員密碼並記錄為初始密碼。
        </p>
      </section>
    </div>
  );
}
