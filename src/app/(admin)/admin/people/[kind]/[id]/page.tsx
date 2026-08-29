import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProfile, getProfilesByEmails, getProfilesByIds, type Profile } from "@/lib/supabase/admin";
import { currentCanEdit, currentStaffRole } from "@/lib/auth/staff";
import { isFullAdmin } from "@/lib/auth/role";
import { grantEnrollmentAction, revokeEnrollment } from "@/actions/admin";
import { claimStudentToMemberAction } from "@/actions/person-roster";
import { EnrollmentEditor } from "../../../members/[id]/enrollment-editor";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";
const fmt = (d: Date | null | undefined) => d ? d.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : "未記錄";
const profileName = (p: Profile | null) => p?.display_name || p?.nickname || p?.email || "未命名會員";

export default async function PersonPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id: rawId } = await params; const id = decodeURIComponent(rawId);
  if (!['student','member','pending'].includes(kind)) notFound();
  let student = kind === "student" ? await prisma.studentRecord.findUnique({ where: { id }, include: { histories: { orderBy: { attendedAt: "desc" } }, engagements: { orderBy: { occurredAt: "desc" } } } }) : null;
  const userId = kind === "member" ? id : student?.claimedUserId ?? null;
  const profile = userId ? await getProfile(userId) : null;
  const email = (kind === "pending" ? id : student?.email || profile?.email || "").trim().toLowerCase();
  if (!student && kind === "member") student = await prisma.studentRecord.findFirst({ where: { claimedUserId: id }, include: { histories: { orderBy: { attendedAt: "desc" } }, engagements: { orderBy: { occurredAt: "desc" } } } });
  if (kind === "student" && !student || kind === "member" && !profile || kind === "pending" && !email) notFound();

  const memberPhone = userId ? await prisma.memberProfile.findUnique({ where: { userId }, select: { phone: true } }) : null;
  const phone = student?.phone || memberPhone?.phone || null;
  const phoneMatches = !student?.claimedUserId && phone ? await prisma.memberProfile.findMany({ where: { phone }, select: { userId: true } }) : [];
  const emailMatches = !student?.claimedUserId && email ? [...(await getProfilesByEmails([email])).values()] : [];
  const phoneProfiles = await getProfilesByIds(phoneMatches.map((m) => m.userId));
  const candidateMap = new Map([...emailMatches, ...phoneProfiles].map((p) => [p.id, p]));
  const candidates = [...candidateMap.values()];

  const [enrollments, pending, signups, relatedStudents, courses, audits] = await Promise.all([
    userId ? prisma.enrollment.findMany({ where: { userId }, include: { course: { select: { title: true } } }, orderBy: { createdAt: "desc" } }) : [],
    email ? prisma.pendingEnrollment.findMany({ where: { email: { equals: email, mode: "insensitive" }, claimedAt: null }, include: { course: { select: { title: true } } }, orderBy: { createdAt: "desc" } }) : [],
    email ? prisma.sessionSignup.findMany({ where: { email: { equals: email, mode: "insensitive" } }, include: { session: { select: { title: true, eventDate: true } } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    email ? prisma.studentRecord.findMany({ where: { email: { equals: email, mode: "insensitive" }, ...(student ? { id: { not: student.id } } : {}) }, select: { id: true, name: true, claimedUserId: true, archivedAt: true } }) : [],
    prisma.course.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: { id: true, title: true, isPublished: true } }),
    student ? prisma.studentDataAuditLog.findMany({ where: { studentId: student.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorEmail: true, createdAt: true } }) : [],
  ]);
  if (kind === "pending" && pending.length === 0 && candidates.length === 0 && relatedStudents.length === 0) notFound();
  const title = student?.name || profileName(profile) || pending[0]?.name || email;
  const canEdit = await currentCanEdit(); const fullAdmin = isFullAdmin(await currentStaffRole());
  const enrolledIds = new Set(enrollments.map((e) => e.courseId));
  const grantAction = userId ? grantEnrollmentAction.bind(null, userId) : null;
  const revokeActions = userId ? Object.fromEntries(enrollments.map((e) => [e.courseId, revokeEnrollment.bind(null, userId!, e.courseId)])) : {};
  return <div className="space-y-6">
    <header><Link href="/admin/people" className="text-sm text-gray-500 hover:underline">← 回學員與名單</Link><h1 className="mt-2 text-2xl font-bold">{title}</h1><div className="mt-2 flex flex-wrap gap-2 text-xs"><span className={`rounded-full px-2 py-1 ${profile ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{profile ? "已註冊會員" : "未註冊"}</span>{student?.archivedAt && <span className="rounded-full bg-gray-200 px-2 py-1">已封存</span>}{student?.claimedUserId && <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">身分已確認連結</span>}</div></header>
    <section className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border bg-white p-5"><h2 className="font-semibold">基本資料</h2><dl className="mt-4 grid grid-cols-[6rem_1fr] gap-y-2 text-sm"><dt className="text-gray-500">Email</dt><dd>{email || "未記錄"}</dd><dt className="text-gray-500">手機</dt><dd>{phone || "未記錄"}</dd><dt className="text-gray-500">舊官網</dt><dd>{student?.legacyAccessStatus || "UNKNOWN"}</dd><dt className="text-gray-500">會員帳號</dt><dd>{profile?.email || "尚未連結"}</dd></dl>{student?.legacyNote && <p className="mt-3 rounded bg-gray-50 p-3 text-sm text-gray-600">{student.legacyNote}</p>}</div>
      <div className="rounded-xl border bg-white p-5"><h2 className="font-semibold">目前判讀</h2><ul className="mt-3 space-y-2 text-sm text-gray-600"><li>正式上課紀錄：{student?.histories.length ?? 0} 筆</li><li>平台影片權限：{enrollments.length} 門</li><li>尚待開通：{pending.length} 門</li><li>活動／問卷接觸：{student?.engagements.length ?? 0} 筆</li></ul>{(student?.histories.length ?? 0) > 0 && enrollments.length === 0 && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">有正式上課紀錄，但目前沒有平台影片權限。這是提醒，不代表系統能判定歷史課名與平台課程必然相同，請人工核對後再開通。</p>}</div></section>

    {!student?.claimedUserId && (candidates.length > 0 || relatedStudents.length > 0) && <section className="rounded-xl border border-purple-200 bg-white p-5"><h2 className="font-semibold text-purple-900">身分待確認</h2><p className="mt-1 text-sm text-gray-500">以下只因 Email 或手機相符而列為候選，系統尚未合併。共用信箱很常見，請先人工核對。</p>{relatedStudents.length > 0 && <div className="mt-3 text-sm text-purple-800">同 Email 另有 {relatedStudents.length} 張學員卡：{relatedStudents.map((s) => <Link className="ml-2 underline" key={s.id} href={`/admin/people/student/${s.id}`}>{s.name || "未命名"}</Link>)}</div>}{candidates.map((p) => <div key={p.id} className="mt-4 border-t pt-4"><div className="font-medium">候選會員：{profileName(p)} <span className="font-normal text-gray-500">{p.email}</span></div>{student ? fullAdmin ? <ClaimForm action={claimStudentToMemberAction.bind(null, student.id, p.id)} label={`${profileName(p)}（${p.email ?? p.id}）`}/> : <p className="mt-2 text-sm text-gray-500">只有管理員可以確認身分連結。</p> : <Link href={`/admin/people/member/${p.id}`} className="mt-2 inline-block text-sm text-blue-600 hover:underline">查看會員人物頁 →</Link>}</div>)}</section>}

    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">可觀看課程影片</h2>{userId && grantAction ? <EnrollmentEditor canEdit={canEdit} enrolled={enrollments.map((e) => ({ courseId: e.courseId, title: e.course.title, enrolledAt: e.createdAt.toISOString(), fromOrder: Boolean(e.orderId), source: e.source, orderId: e.orderId }))} available={courses.filter((c) => !enrolledIds.has(c.id))} grantAction={grantAction} revokeActions={revokeActions}/> : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">尚未連結註冊會員，不能直接開通影片。請先讓學員註冊，或在上方人工確認既有會員身分。</p>}</section>

    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">待開通課程</h2><div className="mt-3 space-y-2">{pending.map((p) => <div key={p.id} className="flex justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm"><span>{p.course.title}</span><span className="text-gray-500">{fmt(p.createdAt)}</span></div>)}{pending.length === 0 && <p className="text-sm text-gray-400">沒有待開通項目</p>}</div></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">正式課程歷史</h2><div className="mt-3 space-y-2">{student?.histories.map((h) => <div key={h.id} className="rounded-lg border p-3 text-sm"><b>{h.courseName}</b><div className="mt-1 text-xs text-gray-500">{fmt(h.attendedAt)} · {h.source || "來源未記錄"}</div>{h.note && <p className="mt-2 text-gray-600">{h.note}</p>}</div>)}{!student?.histories.length && <p className="text-sm text-gray-400">沒有正式課程歷史</p>}</div></section>
      <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">讀冊會／問卷／活動</h2><div className="mt-3 space-y-2">{student?.engagements.map((e) => <div key={e.id} className="rounded-lg border p-3 text-sm"><b>{e.title}</b><div className="mt-1 text-xs text-gray-500">{e.type} · {fmt(e.occurredAt)}</div></div>)}{!student?.engagements.length && <p className="text-sm text-gray-400">沒有活動接觸紀錄</p>}</div></section></div>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">場次報名紀錄</h2><p className="mt-1 text-xs text-gray-400">此區依人物 Email 查找；共用信箱時請搭配姓名人工確認。</p><div className="mt-3 space-y-2">{signups.map((s) => <div key={s.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><span><b>{s.session.title}</b> · 報名姓名 {s.name}</span><span className="text-gray-500">{fmt(s.session.eventDate || s.orderedAt)}</span></div>)}{signups.length === 0 && <p className="text-sm text-gray-400">沒有場次報名紀錄</p>}</div></section>
    {student && <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">異動紀錄</h2><div className="mt-3 space-y-2">{audits.map((a) => <div key={a.id} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{a.action}</span><span className="text-gray-500">{a.actorEmail || "系統"} · {a.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</span></div>)}{audits.length === 0 && <p className="text-sm text-gray-400">尚無異動紀錄</p>}</div></section>}
  </div>;
}
