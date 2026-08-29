import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { groupExactDuplicateStudents } from "@/lib/duplicate-students";
import { claimStudentToMemberAction, mergeStudentRecordsAction } from "@/actions/person-roster";
import { getProfilesByEmails } from "@/lib/supabase/admin";
import { MergeStudentForm } from "../[kind]/[id]/merge-form";
import { ClaimForm } from "../[kind]/[id]/claim-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "重複學員待確認" };

export default async function DuplicateStudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; merged?: string }> }) {
  await pageGuardFullAdmin();
  const params = await searchParams; const q = (params.q ?? "").trim().toLowerCase();
  const students = await prisma.studentRecord.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true, phone: true, claimedUserId: true, legacyAccessStatus: true, createdAt: true, _count: { select: { histories: true, engagements: true } } } });
  const rows = students.map((s) => ({ ...s, historyCount: s._count.histories, engagementCount: s._count.engagements }));
  const groups = groupExactDuplicateStudents(rows).filter((g) => !q || `${g[0].name} ${g[0].email}`.toLowerCase().includes(q));
  const unclaimed = rows.filter((r) => !r.claimedUserId && r.email);
  const profileMap = await getProfilesByEmails(unclaimed.map((r) => r.email!));
  const crossSource = unclaimed.map((student) => ({ student, profile: profileMap.get(student.email!.toLowerCase()) })).filter((r) => r.profile).filter((r) => !q || `${r.student.name} ${r.student.email} ${r.profile?.display_name}`.toLowerCase().includes(q));
  return <div className="space-y-5">
    <header><Link href="/admin/people" className="text-sm text-blue-600">← 回學員與名單</Link><h1 className="mt-2 text-2xl font-bold">重複學員待確認</h1><p className="mt-1 text-sm text-gray-500">包含同姓名同 Email 的多張學員卡，以及「會員帳號＋尚未認領學員卡」的跨來源候選。所有操作都需人工確認。</p></header>
    {params.merged === "1" && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">合併完成，清單已重新計算。</div>}
    <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="搜尋姓名或 Email" className="flex-1 rounded-lg border px-3 py-2"/><button className="rounded-lg bg-black px-4 py-2 text-white">搜尋</button></form>
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="font-bold text-blue-900">跨來源身分待確認：{crossSource.length} 組</h2><p className="mt-1 text-sm text-gray-600">這不是兩張學員卡，而是會員帳號與歷史學員卡尚未連結。確認後會保留兩邊資料，將歷史卡認領給會員。</p>{crossSource.map(({student,profile}) => <div key={student.id} className="mt-4 rounded-lg bg-white p-4"><div className="grid gap-2 text-sm md:grid-cols-5"><div><b>學員卡</b><br/>{student.name || "未填姓名"}</div><div><b>會員</b><br/>{profile!.display_name || profile!.nickname || "未填姓名"}</div><div><b>Email</b><br/>{student.email}</div><div><b>課程／活動</b><br/>{student.historyCount}／{student.engagementCount}</div><div><Link href={`/admin/people/student/${student.id}`} className="text-blue-600">查看完整資料</Link></div></div><ClaimForm action={claimStudentToMemberAction.bind(null, student.id, profile!.id)} label={`${profile!.display_name || profile!.email}（${profile!.email}）`}/></div>)}</section>
    <div className="text-sm text-gray-500">同姓名＋同 Email 多卡：{groups.length} 組</div>
    {groups.map((group, index) => { const target=group[0];const phones=new Set(group.map(r=>r.phone).filter(Boolean));return <section key={`${target.name}-${target.email}`} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold">{target.name} <span className="font-normal text-gray-500">{target.email}</span></h2><p className="text-xs text-gray-400">第 {index+1} 組，共 {group.length} 張卡</p></div>{phones.size>1&&<span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">手機不同，合併會被阻擋</span>}</div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left"><tr><th className="p-2">建議</th><th className="p-2">手機</th><th className="p-2">會員</th><th className="p-2">課程</th><th className="p-2">活動</th><th className="p-2">舊站</th><th className="p-2">建立</th><th className="p-2"></th></tr></thead><tbody>{group.map((row,i)=><tr key={row.id} className="border-t"><td className="p-2">{i===0?<span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">推薦保留</span>:"合併來源"}</td><td className="p-2">{row.phone||"—"}</td><td className="p-2">{row.claimedUserId?"已認領":"未認領"}</td><td className="p-2">{row.historyCount}</td><td className="p-2">{row.engagementCount}</td><td className="p-2">{row.legacyAccessStatus}</td><td className="p-2">{row.createdAt.toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})}</td><td className="p-2"><Link href={`/admin/people/student/${row.id}`} className="text-blue-600">查看</Link></td></tr>)}</tbody></table></div><div className="mt-4 rounded-lg bg-purple-50 p-3"><b className="text-sm text-purple-900">保留：{target.name}（課程 {target.historyCount}／活動 {target.engagementCount}）</b>{group.slice(1).map(source=><MergeStudentForm key={source.id} sourceName={`${source.name}｜建立於 ${source.createdAt.toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})}`} action={mergeStudentRecordsAction.bind(null,source.id,target.id)} returnTo="/admin/people/duplicates"/>)}</div></section> })}
    {groups.length === 0 && crossSource.length === 0 && <div className="rounded-xl border p-10 text-center text-gray-400">沒有符合的重複或跨來源候選</div>}
  </div>;
}
