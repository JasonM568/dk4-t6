import "server-only";

import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import {
  buildBroadcastHtml,
  sendBroadcast,
  applyMergeTags,
  type Recipient,
} from "./broadcast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 以 email 為鍵去重（小寫），保留第一筆姓名
function dedupeByEmail(rows: Recipient[]): Recipient[] {
  const map = new Map<string, Recipient>();
  for (const r of rows) {
    const email = r.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue;
    if (!map.has(email)) map.set(email, { email, name: r.name?.trim() || undefined });
  }
  return [...map.values()];
}

/** 群發收件人：全部有合法 email 的會員（去重、小寫、帶顯示名稱） */
export async function getBroadcastRecipients(): Promise<Recipient[]> {
  const profiles = await listProfiles();
  return dedupeByEmail(
    profiles.map((p) => ({ email: p.email ?? "", name: p.display_name ?? undefined })),
  );
}

export type ManualRow = { email: string; name?: string };

/** 依發送對象解析收件名單（寄出當下解析：群組取最新成員、全部會員含新加入者），帶姓名供變數替換 */
async function resolveRecipients(record: {
  audienceType: string;
  groupId: string | null;
  manualRows: unknown;
}): Promise<{ recipients: Recipient[]; error?: string }> {
  if (record.audienceType === "GROUP") {
    if (!record.groupId) return { recipients: [], error: "缺少名單群組" };
    const members = await prisma.mailGroupMember.findMany({
      where: { groupId: record.groupId },
      select: { email: true, name: true },
    });
    if (members.length === 0)
      return { recipients: [], error: "名單群組不存在或沒有成員" };
    return {
      recipients: dedupeByEmail(
        members.map((m) => ({ email: m.email, name: m.name ?? undefined })),
      ),
    };
  }
  if (record.audienceType === "MANUAL") {
    const rows = (record.manualRows ?? []) as ManualRow[];
    const recipients = dedupeByEmail(rows);
    return recipients.length > 0
      ? { recipients }
      : { recipients: [], error: "手動名單是空的" };
  }
  // ALL：全部會員
  const recipients = await getBroadcastRecipients();
  return recipients.length > 0
    ? { recipients }
    : { recipients: [], error: "找不到任何會員 email" };
}

/** 依群發紀錄內容實際寄出，並回寫結果與名單快照（立即寄送與排程 cron 共用） */
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

  const { recipients, error: resolveError } = await resolveRecipients(record);
  // 逐封產生 HTML：先把 {email}/{name} 替換成該收件人的值，再套品牌信版型
  const r =
    recipients.length > 0
      ? await sendBroadcast(recipients, record.subject, (rcpt) =>
          buildBroadcastHtml(applyMergeTags(record.body, rcpt), course),
        )
      : { sent: 0, failed: 0, error: resolveError ?? "收件名單是空的" };

  await prisma.emailBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: r.sent,
      failedCount: r.failed,
      status: r.sent > 0 ? "SENT" : "FAILED",
      sentAt: new Date(),
      recipients: recipients.map((rcpt) => rcpt.email), // 快照（email 字串）：之後可存成名單群組
    },
  });
  return r;
}

// 卡死回收門檻：認領後超過這時間仍停在 SENDING，視為寄送中途失敗（serverless 逾時/實例回收）
const STALE_SENDING_MS = 15 * 60 * 1000;

/** cron 進入點：先回收卡死的 SENDING，再撈到期排程逐筆認領後寄出 */
export async function processDueBroadcasts() {
  // B8：回收逾時卡在 SENDING 的寄送——標 FAILED（不自動重寄，避免對已收到者重複寄；
  // 由管理員看到 FAILED 後自行決定是否重發），杜絕永久卡「寄送中」。
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const recovered = await prisma.emailBroadcast.updateMany({
    where: { status: "SENDING", claimedAt: { lt: staleBefore } },
    data: { status: "FAILED" },
  });
  if (recovered.count > 0) {
    console.error(`[broadcast cron] 回收 ${recovered.count} 筆卡死的 SENDING → FAILED`);
  }
  // 認領時間遺失的舊資料（claimedAt 為 null 卻卡 SENDING）也一併標 FAILED
  await prisma.emailBroadcast.updateMany({
    where: { status: "SENDING", claimedAt: null },
    data: { status: "FAILED" },
  });

  const due = await prisma.emailBroadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, subject: true },
  });

  const results: { id: string; subject: string; sent: number; failed: number }[] = [];
  for (const b of due) {
    // 原子認領：兩個 cron 重疊執行時，只有一邊搶得到；同時記認領時間供回收判斷
    const claimed = await prisma.emailBroadcast.updateMany({
      where: { id: b.id, status: "SCHEDULED" },
      data: { status: "SENDING", claimedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const r = await executeBroadcast(b.id);
    results.push({ id: b.id, subject: b.subject, sent: r.sent, failed: r.failed });
  }
  return results;
}
