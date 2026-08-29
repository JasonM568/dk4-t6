import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import {
  calculateBroadcastMetrics,
  formatMetricRate,
} from "@/lib/email/analytics";

export const metadata = { title: "EDM 成效儀表板" };
const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

export default async function BroadcastAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await pageGuardEditor();
  const rawDays = Number((await searchParams).days);
  const days = rawDays === 7 || rawDays === 90 ? rawDays : 30;
  // Server page 每次 request 重新計算查詢視窗，刻意使用當下時間。
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const broadcasts = await prisma.emailBroadcast.findMany({
    where: { status: "SENT", sentAt: { gte: since } },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      subject: true,
      audienceLabel: true,
      messageType: true,
      sentCount: true,
      sentAt: true,
    },
  });
  const ids = broadcasts.map((broadcast) => broadcast.id);
  const grouped = ids.length
    ? await prisma.broadcastEvent.groupBy({
        by: ["broadcastId", "type"],
        where: { broadcastId: { in: ids } },
        _count: true,
      })
    : [];
  const counts = new Map(
    grouped.map((row) => [`${row.broadcastId}:${row.type}`, row._count]),
  );
  const rows = broadcasts.map((broadcast) => ({
    ...broadcast,
    metrics: calculateBroadcastMetrics({
      sentCount: broadcast.sentCount,
      delivered: counts.get(`${broadcast.id}:DELIVERED`) ?? 0,
      opened: counts.get(`${broadcast.id}:OPENED`) ?? 0,
      clicked: counts.get(`${broadcast.id}:CLICKED`) ?? 0,
      bounced: counts.get(`${broadcast.id}:BOUNCED`) ?? 0,
      complained: counts.get(`${broadcast.id}:COMPLAINED`) ?? 0,
    }),
  }));
  const total = calculateBroadcastMetrics(
    rows.reduce(
      (sum, row) => ({
        sentCount: sum.sentCount + row.metrics.sentCount,
        delivered: sum.delivered + row.metrics.delivered,
        opened: sum.opened + row.metrics.opened,
        clicked: sum.clicked + row.metrics.clicked,
        bounced: sum.bounced + row.metrics.bounced,
        complained: sum.complained + row.metrics.complained,
      }),
      { sentCount: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 },
    ),
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/broadcast" className="text-sm text-indigo-600 hover:underline">
            ← 回 Email 群發
          </Link>
          <h1 className="mt-1 text-2xl font-bold">EDM 成效儀表板</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1 text-sm">
          {[7, 30, 90].map((value) => (
            <Link
              key={value}
              href={`/admin/broadcast/analytics?days=${value}`}
              className={`rounded-md px-3 py-1.5 ${days === value ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"}`}
            >
              {value} 天
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Provider 已接受", total.sentCount.toLocaleString(), "寄送母集合"],
          ["送達率", formatMetricRate(total.deliveryRate), `${total.delivered} 人`],
          ["點擊率", formatMetricRate(total.clickRate), `${total.clicked} 人`],
          ["開信率（參考）", formatMetricRate(total.openRate), `${total.opened} 人`],
          ["退信率", formatMetricRate(total.bounceRate), `${total.bounced} 人`],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{value}</div>
            <div className="text-xs text-gray-400">{note}</div>
          </div>
        ))}
      </div>
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        開信率會受 Apple Mail Privacy Protection、Gmail 圖片代理等機制影響，只作趨勢參考；營運決策優先看送達率與點擊率。
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-3">寄送時間／主旨</th>
              <th className="px-3 py-3">對象</th>
              <th className="px-3 py-3 text-right">接受</th>
              <th className="px-3 py-3 text-right">送達率</th>
              <th className="px-3 py-3 text-right">點擊率</th>
              <th className="px-3 py-3 text-right">開信參考</th>
              <th className="px-3 py-3 text-right">退信率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">這段期間沒有已完成的 EDM</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2.5">
                  <span className="block text-xs text-gray-400">{row.sentAt?.toLocaleString("zh-TW", TPE)}</span>
                  <Link href={`/admin/broadcast/${row.id}`} className="font-medium text-indigo-600 hover:underline">{row.subject}</Link>
                </td>
                <td className="max-w-56 truncate px-3 py-2.5 text-xs text-gray-500" title={row.audienceLabel ?? "全部會員"}>{row.audienceLabel ?? "全部會員"}</td>
                <td className="px-3 py-2.5 text-right">{row.sentCount}</td>
                <td className="px-3 py-2.5 text-right">{formatMetricRate(row.metrics.deliveryRate)}</td>
                <td className="px-3 py-2.5 text-right font-medium text-indigo-700">{formatMetricRate(row.metrics.clickRate)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500">{formatMetricRate(row.metrics.openRate)}</td>
                <td className="px-3 py-2.5 text-right text-red-600">{formatMetricRate(row.metrics.bounceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
