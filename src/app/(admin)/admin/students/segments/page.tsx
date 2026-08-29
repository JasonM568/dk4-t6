import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { createStudentSegmentGroupAction } from "@/actions/student-history";
import { COURSE_KIND_LABELS, HISTORY_KINDS } from "@/lib/student-course";
import { hasSegmentCondition, parseSegmentFilter, querySegment } from "@/lib/student-segment";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "分眾圈人 — 管理後台" };

const PRESETS = [
  { label: "量子初階未上進階", qs: "attended=qm-basic&excluded=qm-adv" },
  { label: "AI 初階未上進階", qs: "attended=ai-basic&excluded=ai-adv" },
  { label: "鐵粉（上過 4 門以上）", qs: "minCourses=4" },
  { label: "沉睡學員（2025 起沒動靜）", qs: "lastBefore=2025-01-01" },
];

export default async function Segments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageGuardEditor();
  const params = await searchParams;
  const filter = parseSegmentFilter((k) => {
    const v = params[k];
    return Array.isArray(v) ? v : v;
  });
  const courses = await prisma.canonicalCourse.findMany({
    where: { kind: { in: HISTORY_KINDS } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const nameOf = new Map(courses.map((c) => [c.id, c.name]));
  const hasCondition = hasSegmentCondition(filter);
  const students = hasCondition ? await querySegment(filter) : [];
  const emailSet = new Set<string>();
  let noEmail = 0;
  let withPhone = 0;
  for (const s of students) {
    const email = (s.email ?? "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emailSet.add(email);
    else noEmail++;
    if (s.phone) withPhone++;
  }
  const parts = [
    filter.attended.length ? `上過 ${filter.attended.map((id) => nameOf.get(id) ?? id).join("、")}` : "",
    filter.excluded.length ? `未上過 ${filter.excluded.map((id) => nameOf.get(id) ?? id).join("、")}` : "",
    filter.minCourses ? `至少 ${filter.minCourses} 門` : "",
    filter.lastBefore ? `${filter.lastBefore} 後沒動靜` : "",
  ].filter(Boolean);
  const suggestedName = `圈選：${parts.join("；")}`.slice(0, 80);
  const kinds = [...new Set(courses.map((c) => c.kind))];
  return <div className="max-w-5xl">
    <h1 className="text-2xl font-bold">分眾圈人</h1>
    <p className="mb-4 mt-1 text-sm text-gray-500">依「上過什麼、缺什麼」從學員資料庫圈出行動名單，一鍵存成 <strong>EDM 名單群組</strong>後走既有群發流程（含退訂過濾）。條件以<Link href="/admin/students/courses" className="text-indigo-600 underline">課名歸戶</Link>後的標準課程判斷。</p>
    <div className="mb-5 flex flex-wrap gap-2 text-sm">{PRESETS.map((p) => <a key={p.qs} href={`/admin/students/segments?${p.qs}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-indigo-700 hover:bg-indigo-100">{p.label}</a>)}</div>

    <form action="/admin/students/segments" className="rounded-xl border border-gray-200 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">上過其中任一（OR）</legend>
          {kinds.map((kind) => <div key={kind} className="mb-1">
            <p className="mb-0.5 text-xs text-gray-400">{COURSE_KIND_LABELS[kind] ?? kind}</p>
            {courses.filter((c) => c.kind === kind).map((c) => <label key={c.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="attended" value={c.id} defaultChecked={filter.attended.includes(c.id)} />{c.name}</label>)}
          </div>)}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">且完全沒上過</legend>
          {kinds.map((kind) => <div key={kind} className="mb-1">
            <p className="mb-0.5 text-xs text-gray-400">{COURSE_KIND_LABELS[kind] ?? kind}</p>
            {courses.filter((c) => c.kind === kind).map((c) => <label key={c.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="excluded" value={c.id} defaultChecked={filter.excluded.includes(c.id)} />{c.name}</label>)}
          </div>)}
        </fieldset>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4 text-sm">
        <label className="flex items-center gap-2">至少上過<input type="number" name="minCourses" min={2} defaultValue={filter.minCourses ?? ""} className="w-16 rounded border border-gray-300 px-2 py-1" />門不同課程</label>
        <label className="flex items-center gap-2">這天之後沒上課紀錄<input type="date" name="lastBefore" defaultValue={filter.lastBefore ?? ""} className="rounded border border-gray-300 px-2 py-1" /></label>
        <button className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white">試算人數</button>
        {hasCondition && <Link href="/admin/students/segments" className="text-gray-500 underline">清除條件</Link>}
      </div>
    </form>

    {hasCondition && <section className="mt-6 rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b bg-gray-50 px-4 py-3 text-sm">
        <span className="font-semibold">符合 {students.length} 人</span>
        <span className="text-emerald-700">可寄 Email {emailSet.size} 封（去重後）</span>
        {noEmail > 0 && <span className="text-amber-700">沒有 Email {noEmail} 人（EDM 收不到）</span>}
        <span className="text-gray-500">有手機 {withPhone} 人</span>
      </div>
      {students.length > 0 && <>
        <form action={createStudentSegmentGroupAction} className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm">
          {filter.attended.map((id) => <input key={id} type="hidden" name="attended" value={id} />)}
          {filter.excluded.map((id) => <input key={id} type="hidden" name="excluded" value={id} />)}
          {filter.minCourses && <input type="hidden" name="minCourses" value={filter.minCourses} />}
          {filter.lastBefore && <input type="hidden" name="lastBefore" value={filter.lastBefore} />}
          <input name="groupName" defaultValue={suggestedName} required className="w-full max-w-lg rounded border border-gray-300 px-3 py-1.5" />
          <button className="rounded-lg bg-indigo-600 px-4 py-1.5 font-medium text-white">存成名單群組並前往</button>
          <span className="text-xs text-gray-400">存的是此刻快照；同名群組會併入不重複加人</span>
        </form>
        <ul className="max-h-96 overflow-y-auto px-4 py-2 text-sm text-gray-700">{students.slice(0, 200).map((s) => <li key={s.id} className="flex gap-3 border-b border-gray-50 py-1 last:border-b-0"><span className="w-28 truncate">{s.name || "—"}</span><span className="w-32 text-gray-500">{s.phone || "—"}</span><span className="truncate text-gray-400">{s.email || "沒有 Email"}</span></li>)}
        {students.length > 200 && <li className="py-1 text-xs text-gray-400">…僅預覽前 200 位，圈選會包含全部 {students.length} 人</li>}</ul>
      </>}
      {!students.length && <p className="p-6 text-center text-sm text-gray-400">沒有符合條件的學員。</p>}
    </section>}
  </div>;
}
