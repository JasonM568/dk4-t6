import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { formatNT } from "@/lib/format";
import { updateTier } from "@/actions/admin";

export const metadata = { title: "會員管理" };

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string | string[] }>;
}) {
  const { q, group } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const selectedGroupIds = (Array.isArray(group) ? group : group ? [group] : []).filter(Boolean);

  // 會員身分在 Supabase public.profiles（唯讀），消費統計在 course.MemberStats，
  // 應用層以 userId 拼裝（不開 multiSchema、不對 public schema 做 join 寫入）
  const [profiles, statsList, tiers, mailGroups, passwords] = await Promise.all([
    listProfiles(),
    prisma.memberStats.findMany({ include: { currentTier: true } }),
    prisma.membershipTier.findMany({ orderBy: { level: "asc" } }),
    prisma.mailGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.memberPassword.findMany(),
  ]);

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
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const hasFilter = !!query || !!groupEmails;
  // 搜尋（姓名/email 子字串）與群組過濾可並用；無條件時只列前 100 名
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
    : all.slice(0, 100);

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
                className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
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
                className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button className="w-full rounded-lg bg-black py-1.5 text-sm font-medium text-white">
                儲存
              </button>
            </form>
          ))}
        </div>
      </section>

      {/* 會員列表 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {hasFilter
              ? `篩選結果：${members.length} 筆`
              : `會員列表（共 ${all.length} 位，列出消費前 100 名）`}
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

        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">會員</th>
                <th className="px-4 py-3">等級</th>
                <th className="px-4 py-3">累積消費</th>
                <th className="px-4 py-3">購課數</th>
                <th className="px-4 py-3">初始密碼</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    查無符合條件的會員
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.display_name ?? "—"}</div>
                    <div className="text-xs text-gray-400">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">{m.currentTier?.name ?? "—"}</td>
                  <td className="px-4 py-3">{formatNT(m.totalSpent)}</td>
                  <td className="px-4 py-3">{m.coursesBought}</td>
                  <td className="px-4 py-3">
                    {m.initialPassword ? (
                      <span className="font-mono text-xs">{m.initialPassword}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.role === "admin" ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                        管理員
                      </span>
                    ) : (
                      (m.role ?? "會員")
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/members/${m.id}`}
                      className="text-indigo-600 hover:underline"
                    >
                      檢視
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          「初始密碼」為管理員建帳號／批次重設時設定的密碼備查；學員若自行修改過密碼，此欄不會更新。自行註冊的會員無此紀錄。
        </p>
      </section>
    </div>
  );
}
