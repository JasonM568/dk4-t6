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
function dedupeByMobile(
  rows: { mobile?: unknown; name?: string | null; code?: string | null }[],
): {
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
    // 跨場次重複報名的人只留第一筆——連 {code} 也是第一場的碼，
    // 與姓名同一個先到先贏規則（勾選順序決定），預覽與實際發送才會一致
    if (!map.has(mobile))
      map.set(mobile, {
        mobile,
        name: r.name?.trim() || undefined,
        code: r.code || undefined,
      });
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
    // 已延期到其他場次的不收原場次的上課提醒（新場次名單自然涵蓋他）
    where: { sessionId: { in: sessionIds }, deferredToSessionId: null },
    select: {
      sessionId: true,
      name: true,
      phone: true,
      // {code} 變數用：該場次的 /live 查看碼（沒設就是 null）
      session: { select: { accessCode: true } },
    },
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
    const r = dedupeByMobile(signups.map((s) => ({
      mobile: s.phone,
      name: s.name,
      code: s.session.accessCode,
    })));
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
      signups.map((s) => ({
      mobile: s.phone,
      name: s.name,
      code: s.session.accessCode,
    })),
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
      withCodeCount: kept.filter((r) => !!r.code).length,
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
      // 手動名單沒有場次可對應，{code} 一律替換成空字串
      withCodeCount: 0,
    };
  }

  return EMPTY_SMS_AUDIENCE_PREVIEW;
}

/** 補發名單：某筆已發送紀錄「當時沒收到、現在該收到」的人。
 *
 *  場次名單是活的（發完才報名、事後才補手機、上次送失敗），但簡訊**永不自動重寄**
 *  ——多送一封就是多收一次錢。所以補發一律走這裡算出差集，
 *  轉成「手動名單」快照讓管理員逐筆看過再送，不是重跑原名單。
 *
 *  排除誰：上次已送出／已送達／已排入佇列的號碼、明確拒收（STOP）的號碼。
 *  納入誰：新加入名單的人、事後才補手機的人、上次送**失敗**的人。 */
export async function resolveSmsFollowUp(broadcastId: string): Promise<{
  error?: string;
  sourceTitle: string;
  rows: SmsManualRow[];
  alreadySent: number; // 上次已送到／拒收，這次不再送的號碼數
  noMobileCount: number; // 目前名單仍沒有可用手機的人數（補發也救不到，要先去補號碼）
  /** 補發名單中「上次送失敗」的號碼與原因——多半是空號，直接再送多半還是失敗，
   *  要讓管理員看到原因、先去改號碼，而不是白花錢重送 */
  retryFailed: { mobile: string; name?: string; reason: string | null }[];
}> {
  const empty = {
    sourceTitle: "",
    rows: [],
    alreadySent: 0,
    noMobileCount: 0,
    retryFailed: [],
  };
  const record = await prisma.smsBroadcast.findUnique({ where: { id: broadcastId } });
  if (!record) return { ...empty, error: "找不到這筆發送紀錄" };
  const sourceTitle = record.title ?? "（未命名）";
  if (record.audienceType !== "SESSION")
    return {
      ...empty,
      sourceTitle,
      error: "只有「場次」對象的紀錄能算補發名單（手動名單請用「複製」再發）",
    };

  const sessionIds = broadcastSessionIds(record);
  if (sessionIds.length === 0)
    return { ...empty, sourceTitle, error: "這筆紀錄沒有場次資料" };

  const signups = await collectSessionSignups(sessionIds);
  const { recipients, noMobileCount } = dedupeByMobile(
    signups.map((s) => ({
      mobile: s.phone,
      name: s.name,
      code: s.session.accessCode,
    })),
  );
  const { kept } = await filterOptedOut(recipients, record.messageType);

  // 逐筆紀錄優先（能把上次失敗的挑回來補），早期沒有逐筆紀錄的就退回 recipients 快照
  const messages = await prisma.smsMessage.findMany({
    where: { broadcastId },
    select: { mobile: true, status: true, error: true },
  });
  const done = new Set(
    messages.length > 0
      ? messages.filter((m) => m.status !== "FAILED").map((m) => m.mobile)
      : record.recipients,
  );
  const failedReason = new Map(
    messages.filter((m) => m.status === "FAILED").map((m) => [m.mobile, m.error]),
  );

  // 補發轉成手動名單快照時把 code 一起帶著，否則補發的那則 {code} 會是空的
  const rows = kept
    .filter((r) => !done.has(r.mobile))
    .map((r) => ({
      mobile: r.mobile,
      ...(r.name ? { name: r.name } : {}),
      ...(r.code ? { code: r.code } : {}),
    }));

  return {
    sourceTitle,
    rows,
    alreadySent: done.size,
    noMobileCount,
    retryFailed: rows
      .filter((r) => failedReason.has(r.mobile))
      .map((r) => ({ ...r, reason: failedReason.get(r.mobile) ?? null })),
  };
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

  // 逐筆紀錄：之後靠 providerMessageId 向簡訊商查送達狀態。
  // 重送同一筆 broadcast 不會發生（永不自動重寄），所以直接建立即可。
  if (r.results.length > 0) {
    await prisma.smsMessage.createMany({
      data: r.results.map((x) => ({
        broadcastId,
        mobile: x.mobile,
        name: x.name ?? null,
        providerMessageId: x.messageId ?? null,
        status: x.status,
        segments: x.segments,
        error: x.reason ?? null,
        sentAt: x.status === "SENT" ? new Date() : null,
      })),
      skipDuplicates: true, // providerMessageId 唯一鍵兜底
    });
  }

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

/** 向簡訊商更新送達狀態：只查還沒有最終結果的（QUEUED/SENT）。
 *
 *  兩條更新路徑並存：webhook（即時，需在簡訊商後台設定）與這支輪詢
 *  （cron 每 5 分鐘＋後台手動按鈕）。webhook 沒設定時，靠輪詢也查得到，
 *  不會出現「功能看得到卻沒資料」的空殼。
 *
 *  broadcastId 省略 = 掃全部近期未定案的（cron 用）。 */
export async function refreshSmsDelivery(broadcastId?: string) {
  const provider = getSmsProvider();
  if (!provider.queryDelivery) return { checked: 0, updated: 0 };

  const pending = await prisma.smsMessage.findMany({
    where: {
      status: { in: ["QUEUED", "SENT"] },
      providerMessageId: { not: null },
      ...(broadcastId
        ? { broadcastId }
        : // 沒指定就只掃近 7 天：更早的還沒定案代表電信端已放棄回報
          { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } }),
    },
    select: { id: true, providerMessageId: true, broadcastId: true, mobile: true },
    take: 300, // 單次上限，剩下的下一輪再查
    orderBy: { createdAt: "desc" },
  });
  if (pending.length === 0) return { checked: 0, updated: 0 };

  const states = await provider.queryDelivery(
    pending.map((p) => p.providerMessageId!),
  );
  const byId = new Map(states.map((s) => [s.messageId, s]));

  let updated = 0;
  const touchedBroadcasts = new Set<string>();
  const now = new Date();
  for (const p of pending) {
    const s = byId.get(p.providerMessageId!);
    if (!s) continue;
    await prisma.smsMessage.update({
      where: { id: p.id },
      data: {
        status: s.status,
        deliveredAt: s.deliveredAt ?? null,
        error: s.error ?? null,
        checkedAt: now,
        ...(typeof s.segments === "number" ? { segments: s.segments } : {}),
        ...(typeof s.costCents === "number" ? { costCents: s.costCents } : {}),
      },
    });
    updated++;
    touchedBroadcasts.add(p.broadcastId);
    // 收件人明確拒收 → 進退訂名單，之後不再打擾（NCC 合規要求）。
    // source=USER：只擋行銷推播，不擋已報名學員的上課提醒（履約通知）。
    if (s.status === "STOP") {
      await prisma.smsOptOut.upsert({
        where: { mobile: p.mobile },
        create: { mobile: p.mobile, source: "USER", reason: "簡訊回覆拒收" },
        update: {}, // 已在名單就保留最早的來源與原因
      });
    }
  }

  for (const id of touchedBroadcasts) await syncBroadcastCounts(id);
  return { checked: pending.length, updated };
}

/** 把逐筆狀態彙總回 SmsBroadcast（列表頁用一次查詢就看得到送達數） */
export async function syncBroadcastCounts(broadcastId: string) {
  const grouped = await prisma.smsMessage.groupBy({
    by: ["status"],
    where: { broadcastId },
    _count: { _all: true },
  });
  const n = (s: string) =>
    grouped.find((g) => g.status === s)?._count._all ?? 0;
  await prisma.smsBroadcast.update({
    where: { id: broadcastId },
    data: {
      deliveredCount: n("DELIVERED"),
      // 拒收與失敗都算送不到：失敗數要跟著逐筆狀態走，不然畫面自相矛盾
      failedCount: n("FAILED") + n("STOP"),
    },
  });
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
