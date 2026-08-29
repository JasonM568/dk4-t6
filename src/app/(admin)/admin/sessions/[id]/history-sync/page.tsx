import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { normalizeMobile } from "@/lib/sms/phone";
import { buildSessionHistoryPreview } from "@/lib/session-history-sync";
import { syncSessionHistoryAction } from "@/actions/session-history-sync";
import { SyncForm } from "./sync-form";

export const dynamic = "force-dynamic";
export default async function SessionHistorySyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.courseSession.findUnique({ where: { id }, include: { signups: { where: { isStaff: false, deferredToSessionId: null }, orderBy: { name: "asc" } } } });
  if (!session) notFound();
  const normalized = session.signups.map((s) => ({ id: s.id, name: s.name, email: s.email?.trim().toLowerCase() || null, phone: normalizeMobile(s.phone) || null }));
  const phones = normalized.map((s) => s.phone).filter((v): v is string => Boolean(v)); const emails = normalized.map((s) => s.email).filter((v): v is string => Boolean(v));
  const students = await prisma.studentRecord.findMany({ where: { OR: [{ phone: { in: phones } }, { email: { in: emails, mode: "insensitive" } }] }, select: { id: true, name: true, email: true, phone: true } });
  const histories = await prisma.studentCourseHistory.findMany({ where: { studentId: { in: students.map((s) => s.id) }, courseName: session.title, attendedAt: session.eventDate }, select: { studentId: true } });
  const rows = buildSessionHistoryPreview({ signups: normalized, students, existingStudentIds: new Set(histories.map((h) => h.studentId)) });
  return <div className="space-y-5"><header><Link href="/admin/sessions" className="text-sm text-blue-600">← 回場次看板</Link><h1 className="mt-2 text-2xl font-bold">同步上課歷史｜{session.title}</h1><p className="mt-1 text-sm text-gray-500">日期：{session.eventDate?.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) || "未設定"}</p></header><SyncForm rows={rows} action={syncSessionHistoryAction.bind(null, session.id)}/><Link href={`/admin/enrollments?sessionId=${session.id}`} className="inline-block rounded-lg border border-blue-500 px-4 py-2 text-sm font-medium text-blue-700">下一步：處理課後影片權限 →</Link></div>;
}
