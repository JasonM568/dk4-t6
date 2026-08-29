import Link from "next/link";
import { loadPersonRoster } from "@/lib/person-roster-data";
import { personMatchesFilter, personMatchesQuery, type PersonFilter } from "@/lib/person-roster";
import { currentStaffRole } from "@/lib/auth/staff";
import { isFullAdmin } from "@/lib/auth/role";
import { bulkPermanentlyDeleteStudentsAction } from "@/actions/person-roster";
import { PeopleTable } from "./people-table";

export const metadata = { title: "學員與名單" };
export const dynamic = "force-dynamic";

const FILTERS: { value: PersonFilter; label: string }[] = [
  { value: "ALL", label: "全部" }, { value: "REGISTERED", label: "已註冊" },
  { value: "UNREGISTERED", label: "未註冊" }, { value: "ATTENDED_UNREGISTERED", label: "上過課未註冊" },
  { value: "PENDING_REGISTRATION", label: "待註冊／待開通" }, { value: "POSSIBLE_MISSING_ACCESS", label: "可能缺影片權限" },
  { value: "HAS_ACCESS", label: "已有影片" }, { value: "LEGACY", label: "舊官網待處理" },
  { value: "LEAD", label: "潛在名單" }, { value: "IDENTITY_CONFLICT", label: "身分待確認" },
  { value: "SAFE_TO_DELETE", label: "可安全刪除" },
  { value: "SUSPECTED_TEST", label: "疑似測試名單" },
  { value: "ARCHIVED", label: "已封存" },
];
const TASKS: { filter: PersonFilter; title: string; hint: string; color: string }[] = [
  { filter: "PENDING_REGISTRATION", title: "待註冊／待開通", hint: "已有課程需求，但還沒完成會員與權限流程", color: "border-amber-200 bg-amber-50" },
  { filter: "ATTENDED_UNREGISTERED", title: "上過課未註冊", hint: "歷史正式學員，尚未轉成平台會員", color: "border-blue-200 bg-blue-50" },
  { filter: "POSSIBLE_MISSING_ACCESS", title: "可能缺影片權限", hint: "有正式上課紀錄，但平台沒有可觀看課程", color: "border-red-200 bg-red-50" },
  { filter: "IDENTITY_CONFLICT", title: "身分待確認", hint: "Email 重複或同時存在會員與未認領學員卡", color: "border-purple-200 bg-purple-50" },
  { filter: "LEGACY", title: "舊官網待處理", hint: "仍在舊站觀看或待搬遷", color: "border-gray-300 bg-gray-50" },
];
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; deleted?: string }> }) {
  const params = await searchParams; const q = (params.q ?? "").trim();
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter as PersonFilter : "ALL";
  const roster = await loadPersonRoster();
  const rows = roster.filter((p) => personMatchesFilter(p, filter) && personMatchesQuery(p, q))
    .sort((a, b) => Number(b.flags.includes("IDENTITY_CONFLICT")) - Number(a.flags.includes("IDENTITY_CONFLICT")) || a.name.localeCompare(b.name, "zh-Hant"));
  const count = (f: PersonFilter) => roster.filter((p) => personMatchesFilter(p, f)).length;
  const canBulkDelete = isFullAdmin(await currentStaffRole());
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">學員與名單</h1><p className="mt-1 text-sm text-gray-500">從同一個入口查會員、歷史學員、待開通與潛在名單；點進人物可看完整歷程。</p></div><Link href="/admin/people/duplicates" className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-800">查看同名同 Email 重複表 →</Link></header>
    {params.deleted === "1" && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">名單資料已永久刪除；會員登入帳號及其他模組資料均未刪除。</div>}
    <section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">待辦中心</h2><span className="text-xs text-gray-400">數字是目前需要人工確認的筆數</span></div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{TASKS.map((task) => <Link key={task.filter} href={`/admin/people?filter=${task.filter}`} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${task.color}`}><div className="text-2xl font-bold">{count(task.filter)}</div><div className="mt-1 text-sm font-semibold">{task.title}</div><p className="mt-2 text-xs leading-5 text-gray-500">{task.hint}</p></Link>)}</div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <form className="flex flex-wrap gap-2"><input name="q" defaultValue={q} placeholder="搜尋姓名、Email 或手機" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"/><input type="hidden" name="filter" value={filter}/><button className="rounded-lg bg-black px-4 py-2 text-sm text-white">搜尋</button>{q && <Link href={`/admin/people?filter=${filter}`} className="px-3 py-2 text-sm text-gray-500">清除</Link>}</form>
      <div className="mt-4 flex flex-wrap gap-2">{FILTERS.map((f) => <Link key={f.value} href={`/admin/people?filter=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full border px-3 py-1.5 text-xs ${filter === f.value ? "border-black bg-black text-white" : "border-gray-200 hover:bg-gray-50"}`}>{f.label} <span className="opacity-60">{count(f.value)}</span></Link>)}</div>
    </section>
    <PeopleTable rows={rows} canBulkDelete={canBulkDelete} action={bulkPermanentlyDeleteStudentsAction}/>
  </div>;
}
