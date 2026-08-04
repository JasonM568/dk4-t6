// 簡訊模組的可調參數，存 SiteSetting（key-value）。
// 比照 src/lib/site-pages.ts 的做法（注意該檔也沒有 import "server-only"）。
//
// 為什麼放 SiteSetting 而不是環境變數：
//   1. 簡訊單價會隨合約與用量變動，改價不該需要重新部署
//   2. 談價格的人是管理員，不是工程師；改環境變數要有 Vercel 權限
//   3. SiteSetting 本來就是這個專案放「管理員可調數值」的地方

import { prisma } from "@/lib/db";

export const SMS_SETTING_KEYS = {
  pricePerSegment: "sms:pricePerSegment",
  dailyLimit: "sms:dailyLimit",
  singleSendLimit: "sms:singleSendLimit",
  brandPrefix: "sms:brandPrefix",
} as const;

export type SmsSettings = {
  pricePerSegment: number; // 每則單價（元，可小數）
  dailyLimit: number; // 單日則數上限
  singleSendLimit: number; // 單次發送則數上限
  brandPrefix: string; // 簡訊開頭的品牌標示
};

export const SMS_SETTING_DEFAULTS: SmsSettings = {
  pricePerSegment: 1.0,
  dailyLimit: 2000,
  singleSendLimit: 500,
  brandPrefix: "【希望學院】",
};

/** SiteSetting.value 是自由文字，解析一律 clamp + fallback。
 *  絕不能讓 NaN 流進「則數 × 人數 × 單價」的計算裡。 */
function parseNum(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function getSmsSettings(): Promise<SmsSettings> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(SMS_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    pricePerSegment: parseNum(
      map.get(SMS_SETTING_KEYS.pricePerSegment),
      SMS_SETTING_DEFAULTS.pricePerSegment,
      0,
      100,
    ),
    dailyLimit: parseNum(
      map.get(SMS_SETTING_KEYS.dailyLimit),
      SMS_SETTING_DEFAULTS.dailyLimit,
      0,
      1_000_000,
    ),
    singleSendLimit: parseNum(
      map.get(SMS_SETTING_KEYS.singleSendLimit),
      SMS_SETTING_DEFAULTS.singleSendLimit,
      0,
      1_000_000,
    ),
    brandPrefix:
      map.get(SMS_SETTING_KEYS.brandPrefix) ?? SMS_SETTING_DEFAULTS.brandPrefix,
  };
}

export async function setSmsSetting(
  key: keyof typeof SMS_SETTING_KEYS,
  value: string,
) {
  const k = SMS_SETTING_KEYS[key];
  await prisma.siteSetting.upsert({
    where: { key: k },
    update: { value },
    create: { key: k, value },
  });
}

/** 元 → 分（存進紀錄用）。單價低於 NT$1，存整數元會全部變成 0 或 1 */
export const toCents = (yuan: number) => Math.round(yuan * 100);
/** 分 → 顯示字串 NT$46 / NT$4.6 */
export function formatCents(cents: number): string {
  const yuan = cents / 100;
  return "NT$" + (Number.isInteger(yuan) ? yuan.toString() : yuan.toFixed(1));
}
