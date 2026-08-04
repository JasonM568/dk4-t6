"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { normalizeMobile, explainMobile, MOBILE_REJECT_LABEL } from "@/lib/sms/phone";
import { countSms, composeSmsText, hasEmoji, applySmsMergeTags } from "@/lib/sms/message";
import { getSmsSettings, setSmsSetting, toCents } from "@/lib/sms/settings";
import { getSmsProvider } from "@/lib/sms/provider";
import { sendSms } from "@/lib/sms/send";
import {
  executeSmsBroadcast,
  previewSmsAudience,
} from "@/lib/sms/dispatch";
import {
  EMPTY_SMS_AUDIENCE_PREVIEW,
  type SmsAudiencePreview,
  type SmsManualRow,
} from "@/lib/sms/audience";

export type SmsState = {
  error?: string;
  success?: string;
  broadcastId?: string;
} | null;

/** 手動貼入的名單：一行一筆，可「手機,姓名」。回傳可用列與無法辨識的行數 */
function parseMobileRows(raw: string): { rows: SmsManualRow[]; invalid: number } {
  const rows: SmsManualRow[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const [first, ...rest] = t.split(/[,，\t]/).map((x) => x.trim());
    const mobile = normalizeMobile(first);
    if (!mobile) {
      invalid++;
      continue;
    }
    if (seen.has(mobile)) continue;
    seen.add(mobile);
    const name = rest.find(Boolean);
    rows.push(name ? { mobile, name } : { mobile });
  }
  return { rows, invalid };
}

/** 解析發送對象（發送/排程/草稿共用）。lenient = 草稿模式，名單空也照存 */
async function resolveSmsAudience(
  audience: string,
  sessionIds: string[],
  manualRaw: string,
  lenient = false,
): Promise<{
  error?: string;
  data: {
    audienceType: string;
    sessionIds: string[];
    audienceLabel: string;
    manualRows: SmsManualRow[] | undefined;
  };
}> {
  const empty = {
    audienceType: audience === "manual" ? "MANUAL" : "SESSION",
    sessionIds: [],
    audienceLabel: "",
    manualRows: undefined,
  };

  if (audience === "manual") {
    const { rows } = parseMobileRows(manualRaw);
    if (!lenient && rows.length === 0)
      return { error: "手動名單沒有任何可用的手機號碼", data: empty };
    return {
      data: {
        audienceType: "MANUAL",
        sessionIds: [],
        audienceLabel: `手動名單 ${rows.length} 筆`,
        manualRows: rows,
      },
    };
  }

  // SESSION：可複選場次
  const ids = [...new Set(sessionIds.filter(Boolean))];
  const found = ids.length
    ? await prisma.courseSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      })
    : [];
  // findMany 不保證順序：照勾選順序排，標籤與去重的姓名優先序才對得起來
  const byId = new Map(found.map((s) => [s.id, s]));
  const picked = ids.map((id) => byId.get(id)).filter((s) => !!s);

  if (picked.length === 0) {
    if (!lenient) return { error: "請至少勾選一個場次", data: empty };
    return {
      data: { ...empty, audienceType: "SESSION", audienceLabel: "場次：未選擇" },
    };
  }
  // 勾選後場次被刪掉：寧可擋下重選，也不要默默少發一整批人
  if (!lenient && picked.length < ids.length)
    return {
      error: `有 ${ids.length - picked.length} 個場次已不存在（可能剛被刪除），請重新勾選`,
      data: empty,
    };

  const names = picked.map((s) => s.title);
  return {
    data: {
      audienceType: "SESSION",
      sessionIds: picked.map((s) => s.id),
      audienceLabel:
        names.length === 1
          ? `場次：${names[0]}`
          : `場次 ${names.length} 場（已去重）：${names.slice(0, 3).join("、")}${
              names.length > 3 ? ` 等${names.length}場` : ""
            }`,
      manualRows: undefined,
    },
  };
}

/** 後台勾選當下的人數與金額試算（與發送走同一條解析路徑，數字保證一致） */
export async function previewSmsAudienceAction(input: {
  audienceType: string;
  sessionIds: string[];
  manualList?: string;
  messageType: string;
  body: string;
}): Promise<SmsAudiencePreview & { segments: number; estimatedCents: number }> {
  await requireEditor();
  const settings = await getSmsSettings();

  const manualRows =
    input.audienceType === "manual"
      ? parseMobileRows(input.manualList ?? "").rows
      : undefined;

  const preview =
    input.audienceType === "manual" || input.sessionIds.length > 0
      ? await previewSmsAudience({
          audienceType: input.audienceType === "manual" ? "MANUAL" : "SESSION",
          sessionIds: input.sessionIds,
          manualRows,
          messageType: input.messageType,
        })
      : EMPTY_SMS_AUDIENCE_PREVIEW;

  // 以名單中最長姓名估則數上界（{name} 長度不一，估上界才不會低估金額）
  const sampleName = "王".repeat(Math.max(1, preview.maxNameLength));
  const sampleText = composeSmsText(
    applySmsMergeTags(input.body, { mobile: "0912345678", name: sampleName }),
    {
      messageType: input.messageType as "MARKETING" | "NOTICE",
      brandPrefix: settings.brandPrefix,
      optOutUrl: null,
    },
  );
  const segments = countSms(sampleText).segments;

  return {
    ...preview,
    segments,
    estimatedCents:
      preview.sendableCount * segments * toCents(settings.pricePerSegment),
  };
}

/** 測試發送：只送給指定號碼，不留發送紀錄、不受退訂名單影響（同 email 測試信的設計） */
export async function sendSmsTestAction(
  _prev: SmsState,
  formData: FormData,
): Promise<SmsState> {
  await requireEditor();
  const mobileRaw = String(formData.get("testMobile") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const messageType = String(formData.get("messageType") ?? "NOTICE");
  if (!body) return { error: "請填寫簡訊內容" };

  const { mobile, reject } = explainMobile(mobileRaw);
  if (!mobile)
    return {
      error: `測試號碼${reject ? `：${MOBILE_REJECT_LABEL[reject]}` : "格式不正確"}`,
    };

  const settings = await getSmsSettings();
  const provider = getSmsProvider();
  const text = composeSmsText(
    applySmsMergeTags(body, { mobile, name: "測試" }),
    {
      messageType: messageType as "MARKETING" | "NOTICE",
      brandPrefix: settings.brandPrefix,
      optOutUrl: null,
    },
  );
  const r = await sendSms([{ mobile, name: "測試" }], () => text);
  if (r.sent === 0) return { error: r.error ?? "測試發送失敗" };
  return {
    success: provider.isLive
      ? `測試簡訊已送出至 ${mobile}（${countSms(text).segments} 則）`
      : `測試模式：未實際發送，內容已印在伺服器記錄（${countSms(text).segments} 則）`,
  };
}

/** 建立簡訊發送：mode=draft 存草稿 / mode=send 立即發送或排程 */
export async function sendSmsAction(
  _prev: SmsState,
  formData: FormData,
): Promise<SmsState> {
  await requireEditor();
  const admin = await getAuthUser();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const mode = String(formData.get("mode") ?? "draft");
  const messageType = String(formData.get("messageType") ?? "NOTICE");
  const audience = String(formData.get("audience") ?? "session");
  const sessionIds = formData.getAll("sessionIds").map(String).filter(Boolean);
  const manualRaw = String(formData.get("manualList") ?? "");
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const noticeAck = formData.get("noticeAck") === "on";

  if (mode !== "draft") {
    if (!body) return { error: "請填寫簡訊內容" };
    if (hasEmoji(body))
      return {
        error: "簡訊內容不支援 emoji（各家電信顯示不一致，且會影響計費則數），請移除",
      };
    if (messageType === "NOTICE" && !noticeAck)
      return { error: "請勾選確認這是與已報名學員的履約通知" };
  }

  const { error, data } = await resolveSmsAudience(
    audience,
    sessionIds,
    manualRaw,
    mode === "draft",
  );
  if (error) return { error };

  const scheduledAt = scheduledAtRaw ? new Date(`${scheduledAtRaw}:00+08:00`) : null;
  if (scheduledAt) {
    if (Number.isNaN(scheduledAt.getTime())) return { error: "排程時間格式不正確" };
    if (scheduledAt.getTime() < Date.now() + 60_000)
      return { error: "排程時間至少要在 1 分鐘後" };
  }

  const settings = await getSmsSettings();
  const base = {
    title: title || null,
    body,
    messageType,
    sentBy: admin?.email ?? null,
    noticeAckBy: messageType === "NOTICE" && noticeAck ? (admin?.email ?? null) : null,
    unitPriceCents: toCents(settings.pricePerSegment),
    ...data,
    manualRows: data.manualRows ?? undefined,
  };

  if (mode === "draft") {
    const rec = await prisma.smsBroadcast.create({
      data: { ...base, status: "DRAFT" },
    });
    revalidatePath("/admin/sms");
    return { success: "已存成草稿", broadcastId: rec.id };
  }

  if (scheduledAt) {
    const rec = await prisma.smsBroadcast.create({
      data: { ...base, status: "SCHEDULED", scheduledAt },
    });
    revalidatePath("/admin/sms");
    const shown = scheduledAt.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
    return {
      success: `已排程：${shown} 發送給「${data.audienceLabel}」（實際發送最多晚 5 分鐘）`,
      broadcastId: rec.id,
    };
  }

  // 立即發送：先建紀錄再送，結果回寫同一筆。
  // claimedAt 必填：cron 會把「SENDING 且 claimedAt=null」視為卡死回收標 FAILED
  const rec = await prisma.smsBroadcast.create({
    data: { ...base, status: "SENDING", claimedAt: new Date() },
  });
  const r = await executeSmsBroadcast(rec.id);
  revalidatePath("/admin/sms");
  if (r.sent === 0) return { error: r.error ?? "發送失敗", broadcastId: rec.id };
  const provider = getSmsProvider();
  return {
    success: provider.isLive
      ? `已發送 ${r.sent} 人${r.failed > 0 ? `（${r.failed} 筆失敗）` : ""}`
      : `測試模式：已模擬發送 ${r.sent} 人（未實際送出、未計費）`,
    broadcastId: rec.id,
  };
}

export async function cancelScheduledSmsAction(id: string) {
  await requireEditor();
  await prisma.smsBroadcast.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELED" },
  });
  revalidatePath("/admin/sms");
}

export async function deleteSmsDraftAction(id: string) {
  await requireEditor();
  await prisma.smsBroadcast.deleteMany({ where: { id, status: "DRAFT" } });
  revalidatePath("/admin/sms");
}

/** 手動把號碼加進退訂名單（客服代退／回報空號） */
export async function addSmsOptOutAction(
  _prev: SmsState,
  formData: FormData,
): Promise<SmsState> {
  await requireEditor();
  const { mobile, reject } = explainMobile(String(formData.get("mobile") ?? ""));
  if (!mobile)
    return { error: reject ? MOBILE_REJECT_LABEL[reject] : "手機號碼格式不正確" };
  const source = String(formData.get("source") ?? "MANUAL");
  await prisma.smsOptOut.upsert({
    where: { mobile },
    create: { mobile, source, reason: String(formData.get("reason") ?? "") || null },
    update: {}, // 已在名單就不動，保留最早的來源與原因
  });
  revalidatePath("/admin/sms/optouts");
  return { success: `已將 ${mobile} 加入${source === "INVALID" ? "無法送達" : "退訂"}名單` };
}

export async function removeSmsOptOutAction(mobile: string) {
  await requireEditor();
  await prisma.smsOptOut.deleteMany({ where: { mobile } });
  revalidatePath("/admin/sms/optouts");
}

export async function updateSmsSettingsAction(
  _prev: SmsState,
  formData: FormData,
): Promise<SmsState> {
  await requireEditor();
  for (const key of ["pricePerSegment", "dailyLimit", "singleSendLimit", "brandPrefix"] as const) {
    const v = String(formData.get(key) ?? "").trim();
    if (v) await setSmsSetting(key, v);
  }
  revalidatePath("/admin/sms");
  return { success: "已更新簡訊設定" };
}
