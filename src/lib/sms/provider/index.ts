import type { SmsProvider } from "./types";
import { DryRunProvider } from "./dryrun";
import { MaacGoProvider, getMaacGoConfig } from "./maacgo";

let cached: SmsProvider | null = null;

/**
 * 依環境變數回傳目前啟用的簡訊 provider。
 *
 * 與金流模組的關鍵差異：**沒有沙箱預設值**。
 * ECPay 有公開的測試商店，所以 payment/index.ts 可以在非 production 回退到沙箱憑證；
 * 簡訊沒有這種東西——任何「剛好能用的預設憑證」都會真的發出簡訊、真的花錢。
 * 因此未設定 SMS_PROVIDER 時一律回 DryRunProvider，不會誤觸發送。
 *
 * 要啟用 MAAC Go：.env 設 SMS_PROVIDER=maacgo + MAACGO_API_KEY=sk_live_...
 *（sk_test_ 金鑰視為非 live，後台紀錄會標示）。詳見 docs/sms-module.md。
 */
export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  switch (process.env.SMS_PROVIDER) {
    case "maacgo":
      cached = new MaacGoProvider(getMaacGoConfig());
      break;
    case "dryrun":
    default:
      cached = new DryRunProvider();
  }
  return cached;
}

/** 測試用：換過環境變數後清掉快取 */
export function resetSmsProviderCache() {
  cached = null;
}

export * from "./types";
