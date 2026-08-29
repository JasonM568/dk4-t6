import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { getMailHealth, parseHealthFilter, type HealthFilter } from "@/lib/email/health";

export const metadata = { title: "EDM 名單健康" };
const LABEL: Record<Exclude<HealthFilter, "ALL">, string> = {
  USER: "自行退訂",
  BOUNCE: "退信",
  COMPLAINT: "垃圾信檢舉",
  PENDING: "結果不確定",
  INACTIVE: "90 天未點擊",
};
const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

export default async function MailHealthPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await pageGuardEditor();
  const params = await searchParams;
  const filter = parseHealthFilter(params.status);
  const q = (params.q ?? "").trim();
  const data = await getMailHealth(filter, q);
  const tabs: HealthFilter[] = ["ALL", "USER", "BOUNCE", "COMPLAINT", "PENDING", "INACTIVE"];
  const tabCount = (key: HealthFilter) => key === "ALL" ? data.counts.USER + data.counts.BOUNCE + data.counts.COMPLAINT : data.counts[key];

  return (
    <div className="max-w-5xl">
      <Link href="/admin/broadcast" className="text-sm text-indigo-600 hover:underline">← 回 Email 群發</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">EDM 名單健康</h1><p className="mt-1 text-sm text-gray-500">檢視退訂、退信、檢舉與低互動名單；本頁刻意不提供解除抑制，避免誤傷寄件信譽。</p></div>
        <a href={`/api/admin/broadcast/health.csv?status=${filter}&q=${encodeURIComponent(q)}`} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">匯出目前篩選 CSV</a>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((key) => (
          <Link key={key} href={`/admin/broadcast/health?status=${key}`} className={`rounded-full px-3 py-1.5 text-xs ${filter === key ? "bg-black text-white" : "bg-gray-100 text-gray-600"}`}>
            {key === "ALL" ? "抑制名單" : LABEL[key]} {tabCount(key)}
          </Link>
        ))}
      </div>
      <form className="mb-4 flex gap-2"><input type="hidden" name="status" value={filter} /><input name="q" defaultValue={q} placeholder="搜尋 Email" className="w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button className="rounded-lg bg-black px-4 py-2 text-sm text-white">搜尋</button></form>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-3">Email</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3">原因</th><th className="px-3 py-3">時間</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">沒有符合資料</td></tr>}
            {data.rows.map((row) => <tr key={`${row.status}:${row.email}`}><td className="px-3 py-2.5">{row.email}</td><td className="px-3 py-2.5"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{LABEL[row.status]}</span></td><td className="max-w-md px-3 py-2.5 text-xs text-gray-500">{row.reason ?? "—"}</td><td className="px-3 py-2.5 text-xs text-gray-400">{row.occurredAt.toLocaleString("zh-TW", TPE)}</td></tr>)}
          </tbody>
        </table>
      </div>
      {data.rows.length === 500 && <p className="mt-2 text-xs text-amber-700">目前最多顯示 500 筆；可先用狀態或 Email 縮小範圍後匯出。</p>}
    </div>
  );
}
