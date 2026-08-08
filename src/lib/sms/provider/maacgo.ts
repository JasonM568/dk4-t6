import "server-only";

import type { SmsProvider, SmsSendItem, SmsSentResult } from "./types";
import { postWithRetry } from "./http";

// MAAC Go（漸強實驗室 sms.cresclab.com）adapter。
// API：POST /sms/send（1-to-1，Bearer sk_live_/sk_test_），OpenAPI 見
// https://sms.cresclab.com/openapi.yaml。台灣三大電信直連、NCC 合規內建、
// 計價 NT$0.78/段（中文 70 字/段）。
//
// 刻意逐通打 /sms/send 而不用 /broadcast：本模組的內容是逐人渲染（{name} 變數），
// broadcast 端點是同一份 body 群發，對不上「逐筆對應回傳」的介面約定。

export type MaacGoConfig = {
  apiKey: string;
  /** 成本歸屬 team 標籤（MAAC Go 後台報表用），選填 */
  team?: string;
  /** 測試用 API base 覆寫；正式一律打官方端點 */
  apiBase?: string;
};

export function getMaacGoConfig(): MaacGoConfig {
  // 憑證缺漏「不 throw」：module-load throw 會讓整個 /admin/sms 500（見 docs/sms-module.md §8）。
  // 改由 send() 逐筆回失敗＋中文原因，紀錄頁在最需要查看的當下仍看得到
  return {
    apiKey: process.env.MAACGO_API_KEY ?? "",
    team: process.env.MAACGO_TEAM || undefined,
    apiBase: process.env.MAACGO_API_BASE || undefined,
  };
}

/** API 錯誤碼 → 後台看得懂的中文原因（會逐筆寫進 failedRecipients） */
function describeError(status: number, data: unknown): string {
  const d = (data ?? {}) as {
    error?: string;
    hint?: string;
    issues?: { level?: string; code?: string; reason?: string }[];
    topup_url?: string;
  };
  switch (d.error) {
    case "insufficient_balance":
      return "MAAC Go 餘額不足，請至 sms.cresclab.com 儲值後補發";
    case "ncc_blocked": {
      const reasons = (d.issues ?? [])
        .filter((i) => i.level === "block")
        .map((i) => i.reason || i.code)
        .filter(Boolean)
        .join("；");
      return `NCC 合規未過${reasons ? `：${reasons}` : ""}`;
    }
    case "rate_limited":
      return "簡訊商限速，稍後可補發";
    case "invalid_phone":
    case "invalid_phones":
      return "簡訊商判定號碼無效";
    default:
      return d.error
        ? `簡訊商回應錯誤：${d.error}${d.hint ? `（${d.hint}）` : ""}`
        : `簡訊商回應 HTTP ${status}`;
  }
}

export class MaacGoProvider implements SmsProvider {
  readonly name = "maacgo";
  readonly label: string;
  // /sms/send 一次一通；小批循序送＋批間隔，429 另有 postWithRetry 退避兜底
  readonly maxBatchSize = 10;
  readonly interBatchDelayMs = 1_000;
  readonly isLive: boolean;
  readonly supportsDeliveryReceipt = true; // webhook sms.delivered/failed（未接前可 GET /sms/{id} 查）
  readonly supportsMo = false;

  private readonly apiBase: string;
  private readonly keyValid: boolean;

  constructor(private readonly cfg: MaacGoConfig) {
    this.keyValid = /^sk_(live|test)_/.test(cfg.apiKey);
    // sk_test_ 走測試環境不真發：後台紀錄要能區分，比照 dryrun 的明確標示原則
    this.isLive = this.keyValid && cfg.apiKey.startsWith("sk_live_");
    this.label = !this.keyValid
      ? "MAAC Go（憑證未設定）"
      : this.isLive
        ? "MAAC Go（漸強實驗室）"
        : "MAAC Go 測試金鑰（不實際發送）";
    this.apiBase = (cfg.apiBase ?? "https://sms.cresclab.com/api").replace(/\/$/, "");
  }

  async send(items: SmsSendItem[]): Promise<SmsSentResult[]> {
    if (!this.keyValid) {
      const reason =
        "MAACGO_API_KEY 未設定或格式不正確（應為 sk_live_ / sk_test_ 開頭），未發送";
      console.error(`[sms/maacgo] ${reason}`);
      return items.map(() => ({ ok: false as const, reason }));
    }
    // 逐通循序送（非 Promise.all）：維持逐筆對應、可預期的速率、失敗互不影響
    const results: SmsSentResult[] = [];
    for (const it of items) {
      results.push(await this.sendOne(it));
    }
    return results;
  }

  private async sendOne(it: SmsSendItem): Promise<SmsSentResult> {
    const res = await postWithRetry(
      `${this.apiBase}/sms/send`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          to: it.mobile, // API 接受 09XXXXXXXX（normalizeMobile 的產物）
          body: it.text,
          type: "notification", // 第一階段只有上課提醒；行銷推播上線時要改送 marketing 走合規檢查
          ...(this.cfg.team ? { team: this.cfg.team } : {}),
        }),
      },
      "sms/maacgo",
    );

    if ("networkError" in res) {
      return { ok: false, reason: `連線失敗：${res.networkError.slice(0, 120)}` };
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // 非 JSON 回應照走 describeError 的 HTTP fallback
    }

    const body = (data ?? {}) as { ok?: boolean; message_id?: string };
    if (res.ok && body.ok && body.message_id) {
      return { ok: true, messageId: String(body.message_id) };
    }
    return { ok: false, reason: describeError(res.status, data) };
  }
}
