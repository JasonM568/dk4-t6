import "server-only";

import type {
  SmsProvider,
  SmsSendItem,
  SmsSentResult,
  SmsDeliveryState,
  SmsDeliveryStatus,
} from "./types";
import { postWithRetry, getWithRetry } from "./http";

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

/** 簡訊商狀態字串 → 內部狀態。認不得的一律當 QUEUED（還沒有最終結果），
 *  不要亂猜成 FAILED——後台會據此顯示「失敗」，錯報比不報更糟。 */
export function mapMaacGoStatus(raw: unknown): SmsDeliveryStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "delivered":
      return "DELIVERED";
    case "failed":
      return "FAILED";
    case "stop": // 收件人回覆退訂／電信端拒收
      return "STOP";
    case "sent":
      return "SENT";
    default:
      return "QUEUED";
  }
}

/** 簡訊商的英文錯誤碼 → 後台看得懂的中文（查不到的原樣顯示，不吞掉資訊） */
export function describeDeliveryError(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    invalid_phone_number: "號碼無效（空號、停用或非行動電話）",
    invalid_phone: "號碼無效（空號、停用或非行動電話）",
    unreachable: "無法接通（關機、收訊不良或門號已停用）",
    rejected: "電信端拒收",
    blocked: "電信端拒收（號碼在阻擋名單）",
    expired: "逾時未送達（電信重送多次後放棄）",
    insufficient_balance: "簡訊商餘額不足",
    ncc_blocked: "NCC 合規未過",
    rate_limited: "簡訊商限速",
  };
  return map[code] ?? code;
}

/** GET /sms/{id} 或 /sms/list 的單筆內容 → 內部狀態物件 */
function toDeliveryState(raw: unknown): SmsDeliveryState | null {
  const d = (raw ?? {}) as {
    id?: unknown;
    status?: unknown;
    delivered_at?: unknown;
    error?: unknown;
    segments?: unknown;
    cost_cents?: unknown;
  };
  if (typeof d.id !== "string" || !d.id) return null;
  const deliveredAt =
    typeof d.delivered_at === "string" ? new Date(d.delivered_at) : null;
  return {
    messageId: d.id,
    status: mapMaacGoStatus(d.status),
    deliveredAt: deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : null,
    error: describeDeliveryError(typeof d.error === "string" ? d.error : null),
    ...(typeof d.segments === "number" ? { segments: d.segments } : {}),
    ...(typeof d.cost_cents === "number" ? { costCents: d.cost_cents } : {}),
  };
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

  /** 批次查送達狀態。先用 GET /sms/list 一次撈近期（最多 200 筆）比對 id，
   *  剩下沒對到的（較早的發送）才逐筆 GET /sms/{id}——省請求數又不漏掉舊的。 */
  async queryDelivery(messageIds: string[]): Promise<SmsDeliveryState[]> {
    if (!this.keyValid || messageIds.length === 0) return [];
    const wanted = new Set(messageIds);
    const found = new Map<string, SmsDeliveryState>();

    const list = await this.fetchJson("/sms/list?limit=200");
    const messages = (list as { messages?: unknown[] } | null)?.messages;
    if (Array.isArray(messages)) {
      for (const m of messages) {
        const state = toDeliveryState(m);
        if (state && wanted.has(state.messageId)) found.set(state.messageId, state);
      }
    }

    // 逐筆補查上限：一次查太多會拖垮 serverless function，剩下的留給下一輪
    const rest = messageIds.filter((id) => !found.has(id)).slice(0, 100);
    for (const id of rest) {
      const one = await this.fetchJson(`/sms/${encodeURIComponent(id)}`);
      const state = toDeliveryState(one);
      if (state) found.set(state.messageId, state);
    }
    return [...found.values()];
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await getWithRetry(
      `${this.apiBase}${path}`,
      { authorization: `Bearer ${this.cfg.apiKey}` },
      "sms/maacgo",
    );
    if ("networkError" in res) {
      console.error(`[sms/maacgo] 查詢 ${path} 連線失敗：${res.networkError}`);
      return null;
    }
    if (!res.ok) {
      console.error(`[sms/maacgo] 查詢 ${path} 回應 HTTP ${res.status}`);
      return null;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
}
