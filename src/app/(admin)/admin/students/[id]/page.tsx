import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { EngagementsSection, HistoriesSection, StudentProfileForm } from "./maintenance-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "學員資料維護 — 管理後台" };

const dateInput = (date: Date | null) => date ? date.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }) : "";

export default async function StudentDetail({ params }: { params: Promise<{ id: string }> }) {
  await pageGuardEditor();
  const { id } = await params;
  const student = await prisma.studentRecord.findUnique({
    where: { id },
    include: {
      histories: { orderBy: [{ attendedAt: "desc" }, { createdAt: "desc" }] },
      engagements: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!student) notFound();
  const audits = await prisma.studentDataAuditLog.findMany({ where: { studentId: id }, orderBy: { createdAt: "desc" }, take: 20 });

  return <div className="max-w-5xl pb-16">
    <Link href="/admin/students" className="text-sm text-indigo-600 hover:underline">← 回學員資料庫</Link>
    <div className="mt-3 flex flex-wrap items-baseline gap-3"><h1 className="text-2xl font-bold">{student.name || "未填姓名"}</h1><span className="text-sm text-gray-500">{student.claimedUserId ? "已認領會員帳號" : "尚未註冊／未認領"}</span></div>
    <p className="mb-5 mt-1 text-sm text-gray-500">分開維護人物資料、正式上課履歷與其他接觸；本頁不會修改會員帳號、訂單或影片觀看權限。</p>
    <div className="space-y-5">
      <StudentProfileForm student={{ id: student.id, name: student.name, phone: student.phone, email: student.email, legacyAccessStatus: student.legacyAccessStatus, legacyNote: student.legacyNote }} />
      <HistoriesSection studentId={student.id} histories={student.histories.map((h) => ({ id: h.id, courseName: h.courseName, attendedAt: dateInput(h.attendedAt), source: h.source, note: h.note }))} />
      <EngagementsSection studentId={student.id} engagements={student.engagements.map((e) => ({ id: e.id, type: e.type, title: e.title, occurredAt: dateInput(e.occurredAt), source: e.source, note: e.note }))} />
      <section className="rounded-xl border border-gray-200 p-5"><h2 className="font-bold">最近異動</h2>{audits.length ? <ul className="mt-3 divide-y text-sm">{audits.map((a) => <li key={a.id} className="flex flex-wrap gap-x-3 py-2"><span className="font-medium">{a.action}</span><span className="text-gray-500">{a.actorEmail ?? "未知操作者"}</span><time className="ml-auto text-gray-400">{a.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</time></li>)}</ul> : <p className="mt-2 text-sm text-gray-400">尚無人工異動紀錄。</p>}</section>
    </div>
  </div>;
}
