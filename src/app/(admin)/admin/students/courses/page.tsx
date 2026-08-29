import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { assignCourseAliasAction, saveCanonicalCourseAction } from "@/actions/student-history";
import { COURSE_KIND_LABELS, COURSE_LEVEL_LABELS } from "@/lib/student-course";

export const dynamic = "force-dynamic";
export const metadata = { title: "課名歸戶 — 管理後台" };

export default async function CourseCanon() {
  await pageGuardEditor();
  const [courses, aliasList, rawCounts] = await Promise.all([
    prisma.canonicalCourse.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.studentCourseAlias.findMany(),
    prisma.studentCourseHistory.groupBy({ by: ["courseName"], _count: true }),
  ]);
  const aliasMap = new Map(aliasList.map((a) => [a.rawName, a.courseId]));
  const countMap = new Map(rawCounts.map((r) => [r.courseName, r._count]));
  const unmapped = rawCounts
    .filter((r) => !aliasMap.has(r.courseName))
    .sort((a, b) => b._count - a._count);
  const byCourse = new Map<string, { raws: string[]; records: number }>();
  for (const a of aliasList) {
    const g = byCourse.get(a.courseId) ?? { raws: [], records: 0 };
    g.raws.push(a.rawName);
    g.records += countMap.get(a.rawName) ?? 0;
    byCourse.set(a.courseId, g);
  }
  const options = courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>);
  return <div className="max-w-5xl">
    <h1 className="text-2xl font-bold">課名歸戶</h1>
    <p className="mb-5 mt-1 text-sm text-gray-500">同一門課在訂單裡有很多種寫法（「3/26 AI 變現入門課」「2026.03.26 AI初階課程」…），這裡把每種寫法歸到<strong>標準課程</strong>，記錄卡與名單統計都以歸戶後的課程計算。新場次出現的新課名會列在下方「未歸戶」，指派一次即長期受用。<a href="/admin/students" className="text-indigo-600 underline">← 回學員資料庫</a></p>

    {unmapped.length > 0 && <section className="mb-6 overflow-hidden rounded-xl border border-amber-300">
      <div className="border-b bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">未歸戶課名（{unmapped.length} 種）——挑一個標準課程按指派</div>
      <ul>{unmapped.map((r) => <li key={r.courseName} className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm last:border-b-0">
        <span className="flex-1">{r.courseName} <span className="text-xs text-gray-400">{r._count} 筆</span></span>
        <form action={assignCourseAliasAction} className="flex items-center gap-2">
          <input type="hidden" name="rawName" value={r.courseName} />
          <select name="courseId" className="rounded border border-gray-300 px-2 py-1 text-sm" defaultValue="">
            <option value="" disabled>選擇標準課程…</option>
            {options}
          </select>
          <button className="rounded bg-black px-3 py-1 text-sm text-white">指派</button>
        </form>
      </li>)}</ul>
    </section>}
    {!unmapped.length && <p className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">目前所有課名都已歸戶 ✓</p>}

    <section className="overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b bg-gray-50 px-4 py-3 text-sm text-gray-500">標準課程（{courses.length} 個）——展開可查看／改派底下的課名寫法</div>
      {courses.map((c) => {
        const g = byCourse.get(c.id);
        return <details key={c.id} className="border-b border-gray-100 last:border-b-0">
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-4 py-3 hover:bg-gray-50">
            <span className="font-semibold">{c.name}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{COURSE_KIND_LABELS[c.kind] ?? c.kind}</span>
            {c.level && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">{COURSE_LEVEL_LABELS[c.level] ?? c.level}</span>}
            <span className="text-xs text-gray-400">{g?.raws.length ?? 0} 種寫法・{g?.records ?? 0} 筆紀錄</span>
          </summary>
          <ul className="bg-gray-50/60 px-4 py-2">{(g?.raws ?? []).sort().map((raw) => <li key={raw} className="flex flex-wrap items-center gap-2 border-b border-gray-100 py-1.5 text-sm last:border-b-0">
            <span className="flex-1 text-gray-700">{raw} <span className="text-xs text-gray-400">{countMap.get(raw) ?? 0} 筆</span></span>
            <form action={assignCourseAliasAction} className="flex items-center gap-2">
              <input type="hidden" name="rawName" value={raw} />
              <select name="courseId" className="rounded border border-gray-300 px-2 py-1 text-xs" defaultValue={c.id}>
                <option value="">（取消歸戶）</option>
                {options}
              </select>
              <button className="rounded border border-gray-300 px-2 py-1 text-xs">改派</button>
            </form>
          </li>)}
          {!g?.raws.length && <li className="py-1.5 text-sm text-gray-400">尚無課名歸到這裡</li>}</ul>
        </details>;
      })}
    </section>

    <section className="mt-6 rounded-xl border border-gray-200 p-4">
      <h2 className="mb-3 text-sm font-medium text-gray-700">新增標準課程</h2>
      <form action={saveCanonicalCourseAction} className="flex flex-wrap items-center gap-2 text-sm">
        <input name="name" required placeholder="課程名稱（如：量子思維初階）" className="w-64 rounded border border-gray-300 px-3 py-1.5" />
        <select name="kind" className="rounded border border-gray-300 px-2 py-1.5" defaultValue="COURSE">
          {Object.entries(COURSE_KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select name="level" className="rounded border border-gray-300 px-2 py-1.5" defaultValue="">
          <option value="">不分階</option>
          {Object.entries(COURSE_LEVEL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="rounded bg-black px-4 py-1.5 text-white">新增</button>
      </form>
    </section>
  </div>;
}
