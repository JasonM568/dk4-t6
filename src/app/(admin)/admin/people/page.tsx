import Link from "next/link";
import { loadPersonRoster } from "@/lib/person-roster-data";
import { personMatchesFilter, personMatchesQuery, type PersonFilter, type PersonSummary } from "@/lib/person-roster";

export const metadata = { title: "學員與名單" };
export const dynamic = "force-dynamic";

const FILTERS: { value: PersonFilter; label: string }[] = [
  { value: "ALL", label: "全部" }, { value: "REGISTERED", label: "已註冊" },
  { value: "UNREGISTERED", label: "未註冊" }, { value: "ATTENDED_UNREGISTERED", label: "上過課未註冊" },
  { value: "PENDING_REGISTRATION", label: "待註冊／待開通" }, { value: "POSSIBLE_MISSING_ACCESS", label: "可能缺影片權限" },
  { value: "HAS_ACCESS", label: "已有影片" }, { value: "LEGACY", label: "舊官網待處理" },
  { value: "LEAD", label: "潛在名單" }, { value: "IDENTITY_CONFLICT", label: "身分待確認" },
  { value: "ARCHIVED", label: "已封存" },
];
const TASKS: { filter: PersonFilter; title: string; hint: string; color: string }[] = [
  { filter: "PENDING_REGISTRATION", title: "待註冊／待開通", hint: "已有課程需求，但還沒完成會員與權限流程", color: "border-amber-200 bg-amber-50" },
  { filter: "ATTENDED_UNREGISTERED", title: "上過課未註冊", hint: "歷史正式學員，尚未轉成平台會員", color: "border-blue-200 bg-blue-50" },
  { filter: "POSSIBLE_MISSING_ACCESS", title: "可能缺影片權限", hint: "有正式上課紀錄，但平台沒有可觀看課程", color: "border-red-200 bg-red-50" },
  { filter: "IDENTITY_CONFLICT", title: "身分待確認", hint: "Email 重複或同時存在會員與未認領學員卡", color: "border-purple-200 bg-purple-50" },
  { filter: "LEGACY", title: "舊官網待處理", hint: "仍在舊站觀看或待搬遷", color: "border-gray-300 bg-gray-50" },
];
const flagLabel: Partial<Record<PersonFilter, string>> = { ATTENDED_UNREGISTERED: "上過課未註冊", PENDING_REGISTRATION: "待開通", POSSIBLE_MISSING_ACCESS: "可能缺權限", HAS_ACCESS: "有影片", LEGACY: "舊站", LEAD: "潛在", IDENTITY_CONFLICT: "身分待確認", ARCHIVED: "已封存" };

function hrefFor(person: PersonSummary) {
  const id = person.kind === "student" ? person.studentId! : person.kind === "member" ? person.userId! : person.email!;
  return `/admin/people/${person.kind}/${encodeURIComponent(id)}`;
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const params = await searchParams; const q = (params.q ?? "").trim();
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter as PersonFilter : "ALL";
  const roster = await loadPersonRoster();
  const rows = roster.filter((p) => personMatchesFilter(p, filter) && personMatchesQuery(p, q))
    .sort((a, b) => Number(b.flags.includes("IDENTITY_CONFLICT")) - Number(a.flags.includes("IDENTITY_CONFLICT")) || a.name.localeCompare(b.name, "zh-Hant"));
  const count = (f: PersonFilter) => roster.filter((p) => personMatchesFilter(p, f)).length;
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold">學員與名單</h1><p className="mt-1 text-sm text-gray-500">從同一個入口查會員、歷史學員、待開通與潛在名單；點進人物可看完整歷程。</p></header>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">待辦中心</h2><span className="text-xs text-gray-400">數字是目前需要人工確認的筆數</span></div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{TASKS.map((task) => <Link key={task.filter} href={`/admin/people?filter=${task.filter}`} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${task.color}`}><div className="text-2xl font-bold">{count(task.filter)}</div><div className="mt-1 text-sm font-semibold">{task.title}</div><p className="mt-2 text-xs leading-5 text-gray-500">{task.hint}</p></Link>)}</div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <form className="flex flex-wrap gap-2"><input name="q" defaultValue={q} placeholder="搜尋姓名、Email 或手機" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"/><input type="hidden" name="filter" value={filter}/><button className="rounded-lg bg-black px-4 py-2 text-sm text-white">搜尋</button>{q && <Link href={`/admin/people?filter=${filter}`} className="px-3 py-2 text-sm text-gray-500">清除</Link>}</form>
      <div className="mt-4 flex flex-wrap gap-2">{FILTERS.map((f) => <Link key={f.value} href={`/admin/people?filter=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full border px-3 py-1.5 text-xs ${filter === f.value ? "border-black bg-black text-white" : "border-gray-200 hover:bg-gray-50"}`}>{f.label} <span className="opacity-60">{count(f.value)}</span></Link>)}</div>
    </section>
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="border-b px-4 py-3 text-sm text-gray-500">目前顯示 {rows.length} 人</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-gray-500"><tr><th className="px-4 py-3">人物</th><th className="px-4 py-3">狀態</th><th className="px-4 py-3">正式課程</th><th className="px-4 py-3">影片</th><th className="px-4 py-3">待開通</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y">
      {rows.map((p) => <tr key={p.key} className={p.archived ? "bg-gray-50 text-gray-400" : ""}><td className="px-4 py-3"><div className="font-medium text-gray-900">{p.name}</div><div className="text-xs text-gray-500">{p.email || p.phone || "無聯絡資料"}</div></td><td className="px-4 py-3"><div className="mb-1">{p.registered ? <span className="text-green-700">已註冊</span> : <span className="text-amber-700">未註冊</span>}</div><div className="flex max-w-72 flex-wrap gap-1">{p.flags.filter((f) => f !== "HAS_ACCESS").map((f) => <span key={f} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{flagLabel[f]}</span>)}</div></td><td className="px-4 py-3">{p.historyCount}</td><td className="px-4 py-3">{p.enrollmentCount}</td><td className="px-4 py-3">{p.pendingCount}</td><td className="px-4 py-3 text-right"><Link href={hrefFor(p)} className="font-medium text-blue-600 hover:underline">完整資料 →</Link></td></tr>)}
      {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">找不到符合條件的人物</td></tr>}
    </tbody></table></div></section>
  </div>;
}
