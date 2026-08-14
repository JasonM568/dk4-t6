// 統一簡訊供應商介面 —— 之後要接三竹 Mitake / every8d / Twilio，只需新增一個 adapter 檔。
// 形狀比照 src/lib/payment/types.ts（換金流只改那一層的既有設計）。

/** mobile 一律是 normalizeMobile 的產物（09XXXXXXXX）；text 是已組裝好的完整內容 */
export type SmsSendItem = { mobile: string; text: string };

export type SmsSentResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string }; // 中文原因，會直接寫進 failedRecipients

/** 逐筆送達狀態。QUEUED 待送／SENT 電信已接收／DELIVERED 已送達／FAILED 失敗／STOP 拒收退訂。
 *  SENT 只代表電信接收，還不是送到手機——要等 DELIVERED 才算真的到。 */
export type SmsDeliveryStatus = "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "STOP";

export const FINAL_SMS_STATUSES: SmsDeliveryStatus[] = ["DELIVERED", "FAILED", "STOP"];

export type SmsDeliveryState = {
  messageId: string;
  status: SmsDeliveryStatus;
  deliveredAt?: Date | null;
  error?: string | null;
  segments?: number;
  costCents?: number;
};

export interface SmsProvider {
  readonly name: string; // "dryrun" | 日後的簡訊商代號
  readonly label: string; // 後台顯示用
  /** 單批上限；send.ts 依此分批 */
  readonly maxBatchSize: number;
  /** 批次之間的間隔（毫秒），避免觸發業者限速 */
  readonly interBatchDelayMs: number;
  /** 是否真的會送出簡訊。false = 測試模式，後台紀錄必須明確標示 */
  readonly isLive: boolean;
  readonly supportsDeliveryReceipt: boolean;
  /** 回覆簡訊退訂（MO）需另購長門號與上行服務，第一階段一律 false */
  readonly supportsMo: boolean;

  /** 逐筆對應回傳，長度必須等於 items.length。
   *  這是 send.ts 能逐筆記錄 failedRecipients 的前提
   *（同 Resend batch 逐筆檢查 data[j].id 的做法）。 */
  send(items: SmsSendItem[]): Promise<SmsSentResult[]>;

  /** 查詢餘額（點數）；不支援的供應商可不實作 */
  queryBalance?(): Promise<number | null>;

  /** 批次查詢送達狀態（supportsDeliveryReceipt=true 才需實作）。
   *  只回查得到的，查不到的 id 直接略過——呼叫端據此保留原狀態。 */
  queryDelivery?(messageIds: string[]): Promise<SmsDeliveryState[]>;
}
