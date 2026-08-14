import "server-only";

import { getSmsProvider } from "./provider";
import { countSms } from "./message";
import type { SmsRecipient } from "./audience";

// 簡訊批次發送 —— 對照 src/lib/email/broadcast.ts 的 sendBroadcast。
// 重試政策與 email 完全一致：只重試 429/5xx/網路錯誤，指數退避，逐筆記錄失敗原因。

export type FailedSmsRecipient = { mobile: string; name?: string; reason: string };

/** 逐筆結果：追蹤送達狀態的起點。messageId 是之後向簡訊商查狀態的鍵，
 *  以前這個值拿到就丟掉，導致「送出後查不到送達情形」。 */
export type SmsPerRecipientResult = {
  mobile: string;
  name?: string;
  messageId?: string;
  status: "SENT" | "FAILED";
  reason?: string;
  segments: number;
};

export type SmsSendResult = {
  sent: number;
  failed: number;
  error?: string; // 第一個錯誤（摘要用）
  failedRecipients: FailedSmsRecipient[];
  results: SmsPerRecipientResult[];
  provider: string;
  isLive: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 逐人組裝內容後分批送出。
 *
 * renderText 是逐人渲染（{name} 變數），所以每個人的則數可能不同——
 * 呼叫端要自己把 countSms 的結果加總成 actualSegments。
 */
export async function sendSms(
  recipients: SmsRecipient[],
  renderText: (r: SmsRecipient) => string,
): Promise<SmsSendResult> {
  const provider = getSmsProvider();
  const result: SmsSendResult = {
    sent: 0,
    failed: 0,
    failedRecipients: [],
    results: [],
    provider: provider.name,
    isLive: provider.isLive,
  };
  if (recipients.length === 0) return result;

  const failAll = (chunk: SmsRecipient[], reason: string, texts?: string[]) => {
    for (const [k, r] of chunk.entries()) {
      result.failed++;
      result.failedRecipients.push({
        mobile: r.mobile,
        ...(r.name ? { name: r.name } : {}),
        reason,
      });
      result.results.push({
        mobile: r.mobile,
        ...(r.name ? { name: r.name } : {}),
        status: "FAILED",
        reason,
        segments: texts?.[k] ? countSms(texts[k]).segments : 0,
      });
    }
    if (!result.error) result.error = reason;
  };

  for (let i = 0; i < recipients.length; i += provider.maxBatchSize) {
    const chunk = recipients.slice(i, i + provider.maxBatchSize);
    const items = chunk.map((r) => ({ mobile: r.mobile, text: renderText(r) }));

    let sentResults;
    try {
      sentResults = await provider.send(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[sms/send] 批次發送例外：`, msg);
      failAll(chunk, `發送失敗：${msg.slice(0, 200)}`, items.map((x) => x.text));
      continue;
    }

    // 介面約定：逐筆對應。長度不符代表 adapter 有問題，保守地整批判失敗
    if (!Array.isArray(sentResults) || sentResults.length !== chunk.length) {
      console.error(
        `[sms/send] ${provider.name} 回傳筆數不符（預期 ${chunk.length}，實得 ${sentResults?.length}）`,
      );
      failAll(
        chunk,
        "簡訊商回應格式不符，無法確認送出結果",
        items.map((x) => x.text),
      );
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const r = sentResults[j];
      const who = {
        mobile: chunk[j].mobile,
        ...(chunk[j].name ? { name: chunk[j].name } : {}),
        segments: countSms(items[j].text).segments,
      };
      if (r.ok) {
        result.sent++;
        result.results.push({ ...who, status: "SENT", messageId: r.messageId });
      } else {
        result.failed++;
        result.failedRecipients.push({
          mobile: chunk[j].mobile,
          ...(chunk[j].name ? { name: chunk[j].name } : {}),
          reason: r.reason.slice(0, 200),
        });
        result.results.push({ ...who, status: "FAILED", reason: r.reason.slice(0, 200) });
        if (!result.error) result.error = r.reason.slice(0, 200);
      }
    }

    if (provider.interBatchDelayMs > 0 && i + provider.maxBatchSize < recipients.length) {
      await sleep(provider.interBatchDelayMs);
    }
  }

  return result;
}
