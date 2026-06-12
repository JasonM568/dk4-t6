import "server-only";

import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import { buildBroadcastHtml, sendBroadcast } from "./broadcast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 群發收件人：全部有合法 email 的會員（去重、小寫） */
export async function getBroadcastRecipients(): Promise<string[]> {
  const profiles = await listProfiles();
  return [
    ...new Set(
      profiles
        .map((p) => p.email?.trim().toLowerCase())
        .filter((e): e is string => !!e && EMAIL_RE.test(e)),
    ),
  ];
}

/** 依群發紀錄內容實際寄出，並回寫結果（立即寄送與排程 cron 共用） */
export async function executeBroadcast(broadcastId: string) {
  const record = await prisma.emailBroadcast.findUnique({
    where: { id: broadcastId },
  });
  if (!record) return { sent: 0, failed: 0, error: "找不到群發紀錄" };

  const course = record.courseId
    ? await prisma.course.findUnique({
        where: { id: record.courseId },
        select: {
          title: true,
          slug: true,
          coverImage: true,
          price: true,
          listPrice: true,
        },
      })
    : null;

  const html = buildBroadcastHtml(record.body, course);
  const recipients = await getBroadcastRecipients();
  const r =
    recipients.length > 0
      ? await sendBroadcast(recipients, record.subject, html)
      : { sent: 0, failed: 0, error: "找不到任何會員 email" };

  await prisma.emailBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: r.sent,
      failedCount: r.failed,
      status: r.sent > 0 ? "SENT" : "FAILED",
      sentAt: new Date(),
    },
  });
  return r;
}

/** cron 進入點：撈出到期的排程，逐筆認領（防重複寄）後寄出 */
export async function processDueBroadcasts() {
  const due = await prisma.emailBroadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, subject: true },
  });

  const results: { id: string; subject: string; sent: number; failed: number }[] = [];
  for (const b of due) {
    // 原子認領：兩個 cron 重疊執行時，只有一邊搶得到
    const claimed = await prisma.emailBroadcast.updateMany({
      where: { id: b.id, status: "SCHEDULED" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) continue;

    const r = await executeBroadcast(b.id);
    results.push({ id: b.id, subject: b.subject, sent: r.sent, failed: r.failed });
  }
  return results;
}
