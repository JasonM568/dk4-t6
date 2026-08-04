import type { SmsProvider, SmsSendItem, SmsSentResult } from "./types";

/** 測試模式：完整跑完發送流程但不發出任何簡訊、不呼叫任何外部 API、不花任何錢。
 *
 *  這是「未設定簡訊商」時的預設，也是接上真簡訊商之前唯一的 provider。
 *  名單解析、去重、字數則數、金額預估、排程、後台介面全都能用這支驗證。 */
export class DryRunProvider implements SmsProvider {
  readonly name = "dryrun";
  readonly label = "測試模式（未實際發送）";
  readonly maxBatchSize = 100;
  readonly interBatchDelayMs = 0;
  readonly isLive = false;
  readonly supportsDeliveryReceipt = false;
  readonly supportsMo = false;

  private counter = 0;

  async send(items: SmsSendItem[]): Promise<SmsSentResult[]> {
    // 用 console.error 是這個專案的慣例（見 email/broadcast.ts），不是這裡出錯了
    console.error(
      `[sms/dryrun] 測試模式：以下 ${items.length} 則簡訊「不會」實際發送`,
    );
    for (const it of items) {
      console.error(`[sms/dryrun]   → ${it.mobile}：${it.text.replace(/\n/g, "\\n")}`);
    }
    return items.map(() => ({
      ok: true as const,
      messageId: `dryrun-${++this.counter}`,
    }));
  }

  async queryBalance(): Promise<number | null> {
    return null;
  }
}
