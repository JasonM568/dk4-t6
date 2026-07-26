import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listProfiles } from "@/lib/supabase/admin";
import {
  buildBroadcastHtml,
  sendBroadcast,
  applyMergeTags,
  type Recipient,
} from "./broadcast";
import { buildUnsubscribePageUrl } from "./unsubscribe";

// 要求 TLD 至少 2 個字母，防止 user@localhost. 或單字元 TLD 通過
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

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

/** 跟進信名單：依條件從來源群發的成效事件解析（寄出當下即時查，晚開信者不漏） */
async function resolveFollowUpRecipients(record: {
  sourceBroadcastId: string | null;
  followUpFilter: string | null;
}): Promise<{ deduped: Recipient[]; emptyError: string } | { error: string }> {
  if (!record.sourceBroadcastId || !record.followUpFilter) {
    return { error: "跟進信缺少來源群發或跟進條件" };
  }
  const source = await prisma.emailBroadcast.findUnique({
    where: { id: record.sourceBroadcastId },
    select: {
      status: true,
      recipients: true,
      manualRows: true,
      groupId: true,
      audienceType: true,
    },
  });
  if (!source) return { error: "跟進來源群發不存在" };
  if (source.status !== "SENT") {
    return { error: `跟進來源尚未寄出完成（狀態：${source.status}），無法解析名單` };
  }

  const events = await prisma.broadcastEvent.findMany({
    where: {
      broadcastId: record.sourceBroadcastId,
      type: { in: ["OPENED", "CLICKED", "BOUNCED"] },
    },
    select: { email: true, type: true },
  });
  const byType = (t: string) =>
    new Set(events.filter((e) => e.type === t).map((e) => e.email));

  let emails: string[];
  let emptyError: string;
  if (record.followUpFilter === "OPENED") {
    emails = [...byType("OPENED")];
    emptyError = "來源信目前沒有任何開信者（開信事件需要時間回流，可晚點再寄）";
  } else if (record.followUpFilter === "CLICKED") {
    emails = [...byType("CLICKED")];
    emptyError = "來源信目前沒有任何點擊者";
  } else if (record.followUpFilter === "NOT_OPENED") {
    if (source.recipients.length === 0) {
      return { error: "來源群發沒有收件名單快照（舊紀錄），無法計算未開信者" };
    }
    const opened = byType("OPENED");
    const bounced = byType("BOUNCED");
    emails = source.recipients.filter((e) => !opened.has(e) && !bounced.has(e));
    emptyError = "來源信收件人全都已開信（或已退信），沒有未開信者可跟進";
  } else {
    return { error: `跟進條件不正確：${record.followUpFilter}` };
  }

  // 補姓名（{name} 變數替換用；補不到留空，applyMergeTags 會以空字串處理）
  const nameMap = new Map<string, string>();
  const addName = (email: string | null | undefined, name: string | null | undefined) => {
    const key = email?.trim().toLowerCase();
    if (key && name && !nameMap.has(key)) nameMap.set(key, name);
  };
  if (Array.isArray(source.manualRows)) {
    for (const r of source.manualRows as ManualRow[]) addName(r?.email, r?.name);
  } else if (source.groupId) {
    const members = await prisma.mailGroupMember.findMany({
      where: { groupId: source.groupId },
      select: { email: true, name: true },
    });
    for (const m of members) addName(m.email, m.name);
  } else if (source.audienceType === "ALL") {
    const profiles = await listProfiles();
    for (const p of profiles) addName(p.email, p.display_name);
  }

  return {
    deduped: dedupeByEmail(emails.map((email) => ({ email, name: nameMap.get(email) }))),
    emptyError,
  };
}

/** 依發送對象解析收件名單（寄出當下解析：群組取最新成員、全部會員含新加入者），帶姓名供變數替換。
 *  四路匯合後統一過濾退訂名單（MailUnsubscribe）；excludedCount = 被排除的退訂人數 */
async function resolveRecipients(record: {
  audienceType: string;
  groupId: string | null;
  manualRows: unknown;
  sourceBroadcastId: string | null;
  followUpFilter: string | null;
}): Promise<{ recipients: Recipient[]; excludedCount: number; error?: string }> {
  let deduped: Recipient[] = [];
  let emptyError = "";

  if (record.audienceType === "FOLLOWUP") {
    const r = await resolveFollowUpRecipients(record);
    if ("error" in r) return { recipients: [], excludedCount: 0, error: r.error };
    deduped = r.deduped;
    emptyError = r.emptyError;
  } else if (record.audienceType === "GROUP") {
    if (!record.groupId)
      return { recipients: [], excludedCount: 0, error: "缺少名單群組" };
    const members = await prisma.mailGroupMember.findMany({
      where: { groupId: record.groupId },
      select: { email: true, name: true },
    });
    deduped = dedupeByEmail(
      members.map((m) => ({ email: m.email, name: m.name ?? undefined })),
    );
    emptyError = "名單群組不存在或沒有成員";
  } else if (record.audienceType === "MANUAL") {
    deduped = dedupeByEmail((record.manualRows ?? []) as ManualRow[]);
    emptyError = "手動名單是空的";
  } else {
    // ALL：全部會員
    deduped = await getBroadcastRecipients();
    emptyError = "找不到任何會員 email";
  }

  if (deduped.length === 0)
    return { recipients: [], excludedCount: 0, error: emptyError };

  // 過濾退訂名單（email 已於 dedupeByEmail 統一小寫）；測試信不經此路，不受影響
  const unsub = await prisma.mailUnsubscribe.findMany({
    where: { email: { in: deduped.map((r) => r.email) } },
    select: { email: true },
  });
  const unsubSet = new Set(unsub.map((u) => u.email));
  const recipients = deduped.filter((r) => !unsubSet.has(r.email));
  const excludedCount = deduped.length - recipients.length;

  if (recipients.length === 0)
    return { recipients: [], excludedCount, error: "名單全數已退訂，無人可寄" };
  return { recipients, excludedCount };
}

/** 依群發紀錄內容實際寄出，並回寫結果與名單快照（立即寄送與排程 cron 共用） */
export async function executeBroadcast(broadcastId: string) {
  const record = await prisma.emailBroadcast.findUnique({
    where: { id: broadcastId },
  });
  if (!record)
    return { sent: 0, failed: 0, error: "找不到群發紀錄", failedRecipients: [] };

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

  const {
    recipients,
    excludedCount,
    error: resolveError,
  } = await resolveRecipients(record);
  // 逐封產生 HTML：先把 {email}/{name} 替換成該收件人的值，再套品牌信版型（footer 帶個人退訂連結）
  const r =
    recipients.length > 0
      ? await sendBroadcast(
          recipients,
          record.subject,
          (rcpt) =>
            buildBroadcastHtml(
              applyMergeTags(record.body, rcpt),
              course,
              buildUnsubscribePageUrl(rcpt.email),
            ),
          { broadcastId: record.id, withUnsubscribe: true },
        )
      : {
          sent: 0,
          failed: 0,
          error: resolveError ?? "收件名單是空的",
          failedRecipients: [],
        };

  await prisma.emailBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: r.sent,
      failedCount: r.failed,
      status: r.sent > 0 ? "SENT" : "FAILED",
      sentAt: new Date(),
      excludedCount, // 因退訂被排除的人數（明細頁顯示）
      recipients: recipients.map((rcpt) => rcpt.email), // 快照（email 字串）：之後可存成名單群組
      // 逐筆失敗名單（含原因），供明細頁顯示與「補寄失敗者」使用；全成功設 null
      failedRecipients:
        r.failedRecipients.length > 0
          ? r.failedRecipients
          : Prisma.JsonNull,
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
