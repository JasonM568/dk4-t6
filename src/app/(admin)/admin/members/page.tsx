import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { formatNT } from "@/lib/format";
import { updateTier } from "@/actions/admin";

export const metadata = { title: "會員與等級" };

export default async function AdminMembersPage() {
  // 會員身分在 Supabase public.profiles（唯讀），消費統計在 course.MemberStats，
  // 應用層以 userId 拼裝（不開 multiSchema、不對 public schema 做 join 寫入）
  const [profiles, statsList, tiers] = await Promise.all([
    listProfiles(),
    prisma.memberStats.findMany({ include: { currentTier: true } }),
    prisma.membershipTier.findMany({ orderBy: { level: "asc" } }),
  ]);

  const statsByUserId = new Map(statsList.map((s) => [s.userId, s]));
  // MemberStats 是 lazy upsert（首次付款才建立），沒有統計的會員以 0 顯示
  const members = profiles
    .map((p) => {
      const stats = statsByUserId.get(p.id);
      return {
        ...p,
        currentTier: stats?.currentTier ?? null,
        totalSpent: stats?.totalSpent ?? 0,
        coursesBought: stats?.coursesBought ?? 0,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 100);

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
        <h2 className="mb-4 text-2xl font-bold">會員列表（前 100 名）</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">會員</th>
                <th className="px-4 py-3">等級</th>
                <th className="px-4 py-3">累積消費</th>
                <th className="px-4 py-3">購課數</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
      </section>
    </div>
  );
}
