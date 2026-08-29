import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProfiles, listAuthMeta, countProfiles } from "@/lib/supabase/admin";
import { currentCanEdit, currentStaffRole } from "@/lib/auth/staff";
import { isFullAdmin } from "@/lib/auth/role";
import { TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { MemberTable } from "./member-table";
import { CourseMembersJump } from "./course-members-jump";

export const metadata = { title: "會員管理" };

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    group?: string | string[];
    archived?: string;
  }>;
}) {
  const { q, group, archived } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const showArchived = archived === "1";
  const selectedGroupIds = (Array.isArray(group) ? group : group ? [group] : []).filter(Boolean);

  // 會員身分在 Supabase public.profiles（唯讀），消費統計在 course.MemberStats，
  // 應用層以 userId 拼裝（不開 multiSchema、不對 public schema 做 join 寫入）
  const [profiles, statsList, mailGroups, passwords, authMeta, totalCount, zones, archives] =
    await Promise.all([
      listProfiles(),
      prisma.memberStats.findMany({ include: { currentTier: true } }),
      prisma.mailGroup.findMany({
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.memberPassword.findMany(),
      listAuthMeta(),
      // B5：「共 N 位」用真實總數（head:true 只取 count），不受列表筆數影響
      countProfiles(),
      // 企業專區（勾選會員 → 批次加入專區用）
      prisma.courseGroup.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
      prisma.memberArchive.findMany({ orderBy: { archivedAt: "desc" } }),
    ]);

  // 企業專區會籍：email → 所屬專區（含來源：邀請碼註冊 / 手動加入）
  const zoneMemberRows = await prisma.courseGroupMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      source: true,
      group: { select: { id: true, name: true } },
    },
  });
  const zonesByEmail = new Map<
    string,
    { memberId: string; zoneId: string; zoneName: string; byInvite: boolean }[]
  >();
  for (const r of zoneMemberRows) {
    const list = zonesByEmail.get(r.email) ?? [];
    list.push({
      memberId: r.id,
      zoneId: r.group.id,
      zoneName: r.group.name,
      byInvite: r.source === "INVITE",
    });
    zonesByEmail.set(r.email, list);
  }

  // 課程清單：批次開通下拉 + 「查課程觀看名單」捷徑用
  const allCourses = await prisma.course.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, title: true },
  });
  const canEditNow = await currentCanEdit();
  // 密碼重設僅限管理員（server action 也擋，這裡只是不顯示按鈕）
  const canResetPasswordNow = isFullAdmin(await currentStaffRole());

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
  const archivedIds = new Set(archives.map((a) => a.userId));
  const archivedProfileCount = profiles.filter((p) => archivedIds.has(p.id)).length;
  const activeProfileCount = profiles.length - archivedProfileCount;

  // MemberStats 是 lazy upsert（首次付款才建立），沒有統計的會員以 0 顯示
  const all = profiles
    .filter((p) => showArchived ? archivedIds.has(p.id) : !archivedIds.has(p.id))
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

  // 「名單世界」搜尋：帳號搜不到不代表人不存在——email 可能躺在名單群組/專區名單/
  // 待開通存底裡（未註冊或雙信箱）。搜尋時一併掃出，攤在會員表下方灰色區塊。
  const registeredEmails = new Set(
    profiles.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean),
  );
  const listTraces = new Map<string, { name: string | null; sources: string[] }>();
  const addTrace = (email: string, name: string | null, source: string) => {
    const key = email.toLowerCase();
    if (registeredEmails.has(key)) return; // 已註冊的主表就搜得到，不重複列
    const cur = listTraces.get(key) ?? { name: null, sources: [] };
    cur.name = cur.name ?? name;
    if (!cur.sources.includes(source)) cur.sources.push(source);
    listTraces.set(key, cur);
  };
  if (query) {
    const match = {
      OR: [
        { email: { contains: query, mode: "insensitive" as const } },
        { name: { contains: query, mode: "insensitive" as const } },
      ],
    };
    const [mailHits, zoneHits, pendingHits] = await Promise.all([
      prisma.mailGroupMember.findMany({
        where: match,
        select: { email: true, name: true, group: { select: { name: true } } },
      }),
      prisma.courseGroupMember.findMany({
        where: match,
        select: { email: true, name: true, group: { select: { name: true } } },
      }),
      prisma.pendingEnrollment.findMany({
        where: { claimedAt: null, ...match },
        select: { email: true, name: true, course: { select: { title: true } } },
      }),
    ]);
    for (const h of mailHits) addTrace(h.email, h.name, `名單群組「${h.group.name}」`);
    for (const h of zoneHits) addTrace(h.email, h.name, `專區「${h.group.name}」`);
    for (const h of pendingHits) addTrace(h.email, h.name, `待開通「${h.course.title}」`);
  }
  const unregistered = [...listTraces.entries()].map(([email, t]) => ({ email, ...t }));

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
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            會員管理
            <span className="ml-2 text-base font-normal text-gray-400">
              {showArchived ? `已封存 ${archivedProfileCount} 位` : `使用中 ${activeProfileCount}／全部 ${totalCount} 位`}
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {showArchived ? "目前顯示已封存會員；可進入詳情解除封存。" : "搜尋會員、依名單群組篩選；封存會員預設不顯示。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={showArchived ? "/admin/members" : "/admin/members?archived=1"}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          >
            {showArchived ? "← 回使用中會員" : `📦 已封存會員（${archivedProfileCount}）`}
          </Link>
          {/* 查某堂課的觀看名單 → 跳轉到該課程的觀看權限名單頁（可新增/移除/匯出） */}
          <CourseMembersJump courses={allCourses} />
          <Link
            href="/admin/members/inactive"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          >
            🔑 未登入會員（批次設密碼）
          </Link>
          <Link
            href="/admin/members/phone-import"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          >
            📱 訂單回填手機
          </Link>
        </div>
      </header>

      {/* 搜尋 + 名單群組篩選：GET query，免 client JS */}
      <form
        action="/admin/members"
        className="mb-4 space-y-3 rounded-xl border border-gray-200 p-4"
      >
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <div className="flex flex-wrap items-center gap-2">
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
            <>
              <Link
                href={showArchived ? "/admin/members?archived=1" : "/admin/members"}
                className="flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              >
                清除
              </Link>
              <span className="text-sm text-gray-500">
                篩選結果：{members.length} 筆
              </span>
            </>
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
        zones={zones}
        canEdit={!showArchived && canEditNow}
        canResetPassword={!showArchived && canResetPasswordNow}
        courses={allCourses}
        showTier={TIER_SYSTEM_ENABLED}
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
          zoneMemberships: zonesByEmail.get((m.email ?? "").toLowerCase()) ?? [],
        }))}
        groups={mailGroups.map((g) => ({ id: g.id, name: g.name }))}
      />

      {/* 名單中出現但未註冊：雙信箱/未完成註冊一搜現形 */}
      {query && unregistered.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-300 border-dashed bg-gray-50 p-4">
          <div className="text-sm font-medium text-gray-600">
            ⚪ 名單中出現但「未註冊」的 email（{unregistered.length} 筆）
          </div>
          <p className="mt-1 text-xs text-gray-400">
            這些 email 存在於名單裡但沒有帳號，不是會員。若上方帳號列表有同名的人，
            很可能是同一人用別的信箱註冊（雙信箱）——觀看權限請開在上方那個「有帳號」的信箱上。
          </p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="px-2 py-1.5">姓名（名單登記）</th>
                <th className="px-2 py-1.5">Email</th>
                <th className="px-2 py-1.5">出現位置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {unregistered.map((u) => (
                <tr key={u.email} className="text-gray-500">
                  <td className="px-2 py-1.5">{u.name ?? "—"}</td>
                  <td className="px-2 py-1.5">{u.email}</td>
                  <td className="px-2 py-1.5 text-xs">{u.sources.join("、")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">
        「初始密碼」為管理員建帳號／批次重設時設定的密碼備查；學員若自行修改過密碼，此欄不會更新。自行註冊的會員無此紀錄。「重設密碼」會覆蓋該會員密碼並記錄為初始密碼。
      </p>
    </div>
  );
}
