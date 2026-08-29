"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { normalizeMobile } from "@/lib/sms/phone";

export type StudentMaintenanceState = { error?: string; success?: string } | null;

const LEGACY_STATUSES = new Set(["NONE", "ACTIVE", "TO_MIGRATE", "MIGRATED", "UNKNOWN"]);
const ENGAGEMENT_TYPES = new Set(["BOOK_CLUB", "FREQUENCY_MAP", "SEMINAR", "EVENT", "OTHER"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function actorEmail() {
  await requireEditor();
  return (await getAuthUser())?.email ?? null;
}

function text(fd: FormData, key: string) {
  return String(fd.get(key) ?? "").trim();
}

function nullableDate(value: string): Date | null | "invalid" {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function refresh(studentId: string) {
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/students/segments");
}

export async function updateStudentAction(
  studentId: string,
  _previous: StudentMaintenanceState,
  fd: FormData,
): Promise<StudentMaintenanceState> {
  const actor = await actorEmail();
  const name = text(fd, "name") || null;
  const rawPhone = text(fd, "phone");
  const phone = rawPhone ? normalizeMobile(rawPhone) : null;
  const email = text(fd, "email").toLowerCase() || null;
  const legacyAccessStatus = text(fd, "legacyAccessStatus") || "UNKNOWN";
  const legacyNote = text(fd, "legacyNote") || null;

  if (rawPhone && !phone) return { error: "手機格式不正確，請輸入台灣手機號碼" };
  if (email && !EMAIL_RE.test(email)) return { error: "Email 格式不正確" };
  if (!LEGACY_STATUSES.has(legacyAccessStatus)) return { error: "舊官網狀態不正確" };

  const existing = await prisma.studentRecord.findUnique({ where: { id: studentId } });
  if (!existing) return { error: "查無這位學員" };
  if (phone) {
    const conflict = await prisma.studentRecord.findFirst({
      where: { phone, id: { not: studentId } },
      select: { name: true },
    });
    if (conflict)
      return { error: `這支手機已屬於其他學員${conflict.name ? `（${conflict.name}）` : ""}，未儲存也未自動合併` };
  }

  const data = { name, phone, email, legacyAccessStatus, legacyNote };
  await prisma.$transaction(async (tx) => {
    const after = await tx.studentRecord.update({ where: { id: studentId }, data });
    await tx.studentDataAuditLog.create({
      data: { studentId, action: "STUDENT_UPDATE", actorEmail: actor, beforeJson: json(existing), afterJson: json(after) },
    });
  });
  refresh(studentId);
  return { success: "學員資料已更新" };
}

export async function createHistoryAction(
  studentId: string,
  _previous: StudentMaintenanceState,
  fd: FormData,
): Promise<StudentMaintenanceState> {
  const actor = await actorEmail();
  const courseName = text(fd, "courseName");
  const attendedAt = nullableDate(text(fd, "attendedAt"));
  if (!courseName) return { error: "請輸入課程名稱" };
  if (attendedAt === "invalid") return { error: "上課日期格式不正確" };
  if (!(await prisma.studentRecord.findUnique({ where: { id: studentId }, select: { id: true } })))
    return { error: "查無這位學員" };

  await prisma.$transaction(async (tx) => {
    const created = await tx.studentCourseHistory.create({
      data: { studentId, courseName, attendedAt, note: text(fd, "note") || null, source: "MANUAL" },
    });
    await tx.studentDataAuditLog.create({
      data: { studentId, historyId: created.id, action: "HISTORY_CREATE", actorEmail: actor, afterJson: json(created) },
    });
  });
  refresh(studentId);
  return { success: "上課紀錄已新增" };
}

export async function updateHistoryAction(
  studentId: string,
  historyId: string,
  _previous: StudentMaintenanceState,
  fd: FormData,
): Promise<StudentMaintenanceState> {
  const actor = await actorEmail();
  const courseName = text(fd, "courseName");
  const attendedAt = nullableDate(text(fd, "attendedAt"));
  if (!courseName) return { error: "請輸入課程名稱" };
  if (attendedAt === "invalid") return { error: "上課日期格式不正確" };
  const existing = await prisma.studentCourseHistory.findFirst({ where: { id: historyId, studentId } });
  if (!existing) return { error: "查無這筆上課紀錄" };

  await prisma.$transaction(async (tx) => {
    const after = await tx.studentCourseHistory.update({
      where: { id: historyId },
      data: { courseName, attendedAt, note: text(fd, "note") || null },
    });
    await tx.studentDataAuditLog.create({
      data: { studentId, historyId, action: "HISTORY_UPDATE", actorEmail: actor, beforeJson: json(existing), afterJson: json(after) },
    });
  });
  refresh(studentId);
  return { success: "上課紀錄已更新" };
}

export async function deleteHistoryAction(studentId: string, historyId: string): Promise<void> {
  const actor = await actorEmail();
  const existing = await prisma.studentCourseHistory.findFirst({ where: { id: historyId, studentId } });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.studentDataAuditLog.create({
      data: { studentId, historyId, action: "HISTORY_DELETE", actorEmail: actor, beforeJson: json(existing) },
    });
    await tx.studentCourseHistory.delete({ where: { id: historyId } });
  });
  refresh(studentId);
}

export async function createEngagementAction(
  studentId: string,
  _previous: StudentMaintenanceState,
  fd: FormData,
): Promise<StudentMaintenanceState> {
  const actor = await actorEmail();
  const type = text(fd, "type");
  const title = text(fd, "title");
  const occurredAt = nullableDate(text(fd, "occurredAt"));
  if (!ENGAGEMENT_TYPES.has(type)) return { error: "接觸類型不正確" };
  if (!title) return { error: "請輸入活動或問卷名稱" };
  if (occurredAt === "invalid") return { error: "日期格式不正確" };
  if (!(await prisma.studentRecord.findUnique({ where: { id: studentId }, select: { id: true } })))
    return { error: "查無這位學員" };

  await prisma.$transaction(async (tx) => {
    const created = await tx.studentEngagement.create({
      data: { studentId, type, title, occurredAt, source: "MANUAL", note: text(fd, "note") || null },
    });
    await tx.studentDataAuditLog.create({
      data: { studentId, action: "ENGAGEMENT_CREATE", actorEmail: actor, afterJson: json(created) },
    });
  });
  refresh(studentId);
  return { success: "其他接觸紀錄已新增" };
}

export async function deleteEngagementAction(studentId: string, engagementId: string): Promise<void> {
  const actor = await actorEmail();
  const existing = await prisma.studentEngagement.findFirst({ where: { id: engagementId, studentId } });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.studentDataAuditLog.create({
      data: { studentId, action: "ENGAGEMENT_DELETE", actorEmail: actor, beforeJson: json(existing) },
    });
    await tx.studentEngagement.delete({ where: { id: engagementId } });
  });
  refresh(studentId);
}
