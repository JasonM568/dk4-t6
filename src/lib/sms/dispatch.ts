import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeMobile } from "./phone";
import { countSms, composeSmsText, applySmsMergeTags } from "./message";
import { getSmsSettings, toCents } from "./settings";
import { getSmsProvider } from "./provider";
import { sendSms } from "./send";
import {
  EMPTY_SMS_AUDIENCE_PREVIEW,
  broadcastSessionIds,
  type SmsAudiencePreview,
  type SmsManualRow,
  type SmsRecipient,
} from "./audience";

// 對照 src/lib/email/dispatch.ts。名單一律「發送當下」才解析
//（場次取最新報名名單），與 EDM 同一條規則。

/** 以手機為鍵去重，保留第一筆姓名。
 *  對照 email 的 dedupeByEmail：這是唯一的去重點，任何新的名單來源都要匯進這裡。 */
function dedupeByMobile(rows: { mobile?: unknown; name?: string | null }[]): {
  recipients: SmsRecipient[];
  noMobileCount: number;
} {
  const map = new Map<string, SmsRecipient>();
  let noMobileCount = 0;
  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    if (!mobile) {
      // 沒填、市話、格式錯：這些人收不到，必須讓操作者看到數字而不是無聲消失
      noMobileCount++;
      continue;
    }
    if (!map.has(mobile))
      map.set(mobile, { mobile, name: r.name?.trim() || undefined });
  }
  return { recipients: [...map.values()], noMobileCount };
}

/** 退訂／無法送達過濾。
 *
 *  與 email 的關鍵差異：行銷退訂**不得**擋掉已報名學員的上課提醒——
 *  那是他付費課程的履約通知，退訂行銷不代表放棄上課通知。
 *  所以 NOTICE 只扣 INVALID（空號/停用），MARKETING 才扣全部。
 *  分支刻意放在這個單一漏斗裡，任何呼叫端都不可能繞過。 */
async function filterOptedOut(
  recipients: SmsRecipient[],
  messageType: string,
): Promise<{ kept: SmsRecipient[]; excludedCount: number }> {
  if (recipients.length === 0) return { kept: [], excludedCount: 0 };
  const rows = await prisma.smsOptOut.findMany({
    where: {
      mobile: { in: recipients.map((r) => r.mobile) },
      ...(messageType === "NOTICE" ? { source: "INVALID" } : {}),
    },
    select: { mobile: true },
  });
  const blocked = new Set(rows.map((r) => r.mobile));
  const kept = recipients.filter((r) => !blocked.has(r.mobile));
  return { kept, excludedCount: recipients.length - kept.length };
}

/** 取多個場次的報名者，依勾選順序排序。
 *  排序的理由同 email 的 collectGroupMembers：dedupeByMobile 先到先贏，
 *  跨場次重複報名的學員，{name} 必須穩定取到同一個值，否則預覽與實際發送會不一致。 */
async function collectSessionSignups(sessionIds: string[]) {
  const rows = await prisma.sessionSignup.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, name: true, phone: true },
  });
  const rank = new Map(sessionIds.map((id, i) => [id, i]));
  return rows.sort(
    (a, b) => (rank.get(a.sessionId) ?? 0) - (rank.get(b.sessionId) ?? 0),
  );
}

/** 依發送對象解析收件手機。三路匯合後統一去重與退訂過濾。 */
async function resolveMobiles(record: {
  audienceType: string;
  sessionIds: string[];
  manualRows: unknown;
  messageType: string;
}): Promise<{
  recipients: SmsRecipient[];
  excludedCount: number;
  noMobileCount: number;
  error?: string;
}> {
  let deduped: SmsRecipient[] = [];
  let noMobileCount = 0;
  let emptyError = "";

  if (record.audienceType === "SESSION") {
    const sessionIds = broadcastSessionIds(record);
    if (sessionIds.length === 0)
      return { recipients: [], excludedCount: 0, noMobileCount: 0, error: "缺少場次" };
    const signups = await collectSessionSignups(sessionIds);
    const r = dedupeByMobile(signups.map((s) => ({ mobile: s.phone, name: s.name })));
    deduped = r.recipients;
    noMobileCount = r.noMobileCount;
    emptyError =
      sessionIds.length > 1
        ? "所選場次都沒有可發送的手機號碼"
        : "該場次沒有可發送的手機號碼";
  } else if (record.audienceType === "MANUAL") {
    const r = dedupeByMobile((record.manualRows ?? []) as SmsManualRow[]);
    deduped = r.recipients;
    noMobileCount = r.noMobileCount;
    emptyError = "手動名單沒有任何可用的手機號碼";
  } else {
    // GROUP 保留給第二階段（名單群組加手機欄位後才接線）
    return {
      recipients: [],
      excludedCount: 0,
      noMobileCount: 0,
      error: `尚未支援的發送對象：${record.audienceType}`,
    };
  }

  if (deduped.length === 0)
    return { recipients: [], excludedCount: 0, noMobileCount, error: emptyError };

  const { kept, excludedCount } = await filterOptedOut(deduped, record.messageType);
  if (kept.length === 0)
    return {
      recipients: [],
      excludedCount,
      noMobileCount,
      error: "名單全數已退訂或無法送達",
    };
  return { recipients: kept, excludedCount, noMobileCount };
}

/** 後台送出前的人數與金額試算。
 *  刻意與發送走同一條 collect → dedupeByMobile → filterOptedOut，
 *  所以「實際可發 N 人」就是發送後的 sentCount。 */
export async function previewSmsAudience(input: {
  audienceType: string;
  sessionIds: string[];
  manualRows?: SmsManualRow[];
  messageType: string;
}): Promise<SmsAudiencePreview> {
  if (input.audienceType === "SESSION") {
    const sessionIds = broadcastSessionIds(input);
    if (sessionIds.length === 0) return EMPTY_SMS_AUDIENCE_PREVIEW;

    const [found, signups] = await Promise.all([
      prisma.courseSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, title: true },
      }),
      collectSessionSignups(sessionIds),
    ]);

    const rowsBySession = new Map<string, number>();
    for (const s of signups)
      rowsBySession.set(s.sessionId, (rowsBySession.get(s.sessionId) ?? 0) + 1);
    const byId = new Map(found.map((s) => [s.id, s]));
    const sources = sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is { id: string; title: string } => !!s)
      .map((s) => ({
        id: s.id,
        label: s.title,
        rowCount: rowsBySession.get(s.id) ?? 0,
      }));

    const { recipients: deduped, noMobileCount } = dedupeByMobile(
      signups.map((s) => ({ mobile: s.phone, name: s.name })),
    );
    const { kept, excludedCount } = await filterOptedOut(deduped, input.messageType);

    return {
      sources,
      missingCount: sessionIds.length - sources.length,
      totalRows: signups.length,
      noMobileCount,
      uniqueCount: deduped.length,
      duplicateCount: signups.length - noMobileCount - deduped.length,
      optedOutCount: excludedCount,
      sendableCount: kept.length,
      maxNameLength: kept.reduce((n, r) => Math.max(n, r.name?.length ?? 0), 0),
    };
  }

  if (input.audienceType === "MANUAL") {
    const rows = input.manualRows ?? [];
    const { recipients: deduped, noMobileCount } = dedupeByMobile(rows);
    const { kept, excludedCount } = await filterOptedOut(deduped, input.messageType);
    return {
      sources: [{ id: "manual", label: "手動名單", rowCount: rows.length }],
      missingCount: 0,
      totalRows: rows.length,
      noMobileCount,
      uniqueCount: deduped.length,
      duplicateCount: rows.length - noMobileCount - deduped.length,
      optedOutCount: excludedCount,
      sendableCount: kept.length,
      maxNameLength: kept.reduce((n, r) => Math.max(n, r.name?.length ?? 0), 0),
    };
  }

  return EMPTY_SMS_AUDIENCE_PREVIEW;
}

/** 今日（台北時間）已送出的則數總和，供每日上限判斷 */
async function todaySegments(): Promise<number> {
  const nowTaipei = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }),
  );
  const startTaipei = new Date(nowTaipei);
  startTaipei.setHours(0, 0, 0, 0);
  // 台北零點換算回 UTC 瞬間
  const startUtc = new Date(startTaipei.getTime() - 8 * 60 * 60 * 1000);
  const agg = await prisma.smsBroadcast.aggregate({
    where: { sentAt: { gte: startUtc } },
    _sum: { actualSegments: true },
  });
  return agg._sum.actualSegments ?? 0;
}

/** 依發送紀錄實際送出，並回寫結果與名單快照（立即發送與排程 cron 共用）。
 *
 *  花費上限刻意擋在這裡而不是 server action：排程是發送當下才解析名單，
 *  一封週五排定、週一發送的簡訊，名單可能從 50 人長成 5000 人，
 *  擋在 action 會被完全繞過。超過上限一律 FAILED，零發送零花費。 */
export async function executeSmsBroadcast(broadcastId: string) {
  const record = await prisma.smsBroadcast.findUnique({ where: { id: broadcastId } });
  if (!record)
    return { sent: 0, failed: 0, error: "找不到簡訊發送紀錄", failedRecipients: [] };

  const settings = await getSmsSettings();
  const provider = getSmsProvider();

  const { recipients, excludedCount, noMobileCount, error: resolveError } =
    await resolveMobiles(record);

  const renderText = (r: SmsRecipient) =>
    composeSmsText(applySmsMergeTags(record.body, r), {
      messageType: record.messageType as "MARKETING" | "NOTICE",
      brandPrefix: settings.brandPrefix,
      optOutUrl: null, // 退訂短連結為第二階段；NOTICE 本來就不帶
    });

  // 逐人計算則數後加總（{name} 長度不一，每個人的則數可能不同）
  const totalSegments = recipients.reduce(
    (n, r) => n + countSms(renderText(r)).segments,
    0,
  );

  const fail = async (reason: string) => {
    await prisma.smsBroadcast.update({
      where: { id: broadcastId },
      data: {
        status: "FAILED",
        sentAt: new Date(),
        excludedCount,
        noMobileCount,
        provider: provider.name,
        failedRecipients: [{ mobile: "-", reason }] as Prisma.InputJsonValue,
      },
    });
    return { sent: 0, failed: 0, error: reason, failedRecipients: [] };
  };

  if (recipients.length === 0)
    return fail(resolveError ?? "沒有可發送的收件人");

  // 上限檢查：超過就整批不送，而不是送一半
  if (totalSegments > settings.singleSendLimit)
    return fail(
      `本次需 ${totalSegments} 則，超過單次上限 ${settings.singleSendLimit} 則，已取消發送`,
    );
  const used = await todaySegments();
  if (used + totalSegments > settings.dailyLimit)
    return fail(
      `本次需 ${totalSegments} 則，今日已用 ${used} 則，超過每日上限 ${settings.dailyLimit} 則，已取消發送`,
    );

  const r = await sendSms(recipients, renderText);

  const unitPriceCents = toCents(settings.pricePerSegment);
  await prisma.smsBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: r.sent,
      failedCount: r.failed,
      excludedCount,
      noMobileCount,
      actualSegments: totalSegments,
      unitPriceCents,
      // 測試模式一律記 0 元，避免測試數據污染花費統計
      estimatedCostCents: r.isLive ? totalSegments * unitPriceCents : 0,
      provider: r.provider,
      status: r.sent > 0 ? "SENT" : "FAILED",
      sentAt: new Date(),
      recipients: recipients.map((x) => x.mobile),
      failedRecipients:
        r.failedRecipients.length > 0
          ? (r.failedRecipients as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
  return r;
}

// 卡死回收門檻：認領後超過這時間仍停在 SENDING，視為發送中途失敗
const STALE_SENDING_MS = 15 * 60 * 1000;

/** cron 進入點：先回收卡死的 SENDING，再撈到期排程逐筆認領後發送。
 *  對照 email 的 processDueBroadcasts。**永不自動重寄**——
 *  對簡訊來說重寄不只是煩人，是再收一次錢。 */
export async function processDueSmsBroadcasts() {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const recovered = await prisma.smsBroadcast.updateMany({
    where: { status: "SENDING", claimedAt: { lt: staleBefore } },
    data: { status: "FAILED" },
  });
  if (recovered.count > 0) {
    console.error(`[sms cron] 回收 ${recovered.count} 筆卡死的 SENDING → FAILED`);
  }
  await prisma.smsBroadcast.updateMany({
    where: { status: "SENDING", claimedAt: null },
    data: { status: "FAILED" },
  });

  const due = await prisma.smsBroadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, title: true },
  });

  const results: { id: string; title: string; sent: number; failed: number }[] = [];
  for (const b of due) {
    // 原子認領：兩個 cron 重疊執行時只有一邊搶得到
    const claimed = await prisma.smsBroadcast.updateMany({
      where: { id: b.id, status: "SCHEDULED" },
      data: { status: "SENDING", claimedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const r = await executeSmsBroadcast(b.id);
    results.push({
      id: b.id,
      title: b.title ?? "(未命名)",
      sent: r.sent,
      failed: r.failed,
    });
  }
  return results;
}
