// 收支模組的可調參數，存 SiteSetting（key-value），做法完全比照 src/lib/sms/settings.ts。
//
// 為什麼放 SiteSetting 而不是寫死：現行 Excel 已出現兩套費率並存
//（ATM 新版 $15/筆 vs 分享會舊版 金額×1%），改費率的人是管理員不是工程師。
// 費率一律存 ppm（百萬分之一：2% = 20000、2.4% = 24000）——
// 理由同簡訊存「分」：2.4% 用整數百分比存不下。

import { prisma } from "@/lib/db";

export const FINANCE_SETTING_KEYS = {
  invoiceTaxPpm: "finance:invoiceTaxPpm",
  incomeTaxPpm: "finance:incomeTaxPpm",
  cardFeePpm: "finance:cardFeePpm",
  cardInstallFeePpm: "finance:cardInstallFeePpm",
  atmMode: "finance:atmMode",
  atmUnitFee: "finance:atmUnitFee",
  atmFeePpm: "finance:atmFeePpm",
  remitUnitFee: "finance:remitUnitFee",
  internalShares: "finance:internalShares",
  externalSharePpm: "finance:externalSharePpm",
  internalPromoters: "finance:internalPromoters",
} as const;

export type InternalShareSetting = { name: string; ppm: number };

export type FinanceSettings = {
  invoiceTaxPpm: number; // 發票稅金（基數：總收入）
  incomeTaxPpm: number; // 營所稅（基數：總收入）
  cardFeePpm: number; // 信用卡單筆（基數：該付款方式收入）
  cardInstallFeePpm: number; // 信用卡分期（基數：該付款方式收入）
  atmMode: "UNIT" | "RATE"; // UNIT = $X/筆（新版）；RATE = 金額 × %（分享會舊版）
  atmUnitFee: number; // 元/筆
  atmFeePpm: number;
  remitUnitFee: number; // 分潤匯費 元/筆（筆數 = 內部分潤人數）
  internalShares: InternalShareSetting[]; // 預設內部分潤（每場可覆寫）
  externalSharePpm: number; // 外部分潤預設費率（基數：歸屬訂單的新生認列金額）
  internalPromoters: string[]; // 內部人員名單：推廣頁/推薦人是這些人不產生外部分潤
};

export const FINANCE_SETTING_DEFAULTS: FinanceSettings = {
  invoiceTaxPpm: 50_000, // 5%
  incomeTaxPpm: 20_000, // 2%
  cardFeePpm: 20_000, // 2%
  cardInstallFeePpm: 24_000, // 2.4%
  atmMode: "UNIT",
  atmUnitFee: 15,
  atmFeePpm: 10_000, // 1%（舊版分享會用）
  remitUnitFee: 15,
  internalShares: [
    { name: "顧院長", ppm: 400_000 },
    { name: "孟宏", ppm: 400_000 },
    { name: "舒庭", ppm: 200_000 },
  ],
  externalSharePpm: 200_000, // 20%（量子 6/27 表全體 20%，Jason 2026-08-28 拍板）
  // 比對用「包含」：訂單上的「顧及然 院長」「陳孟宏」都對得上
  internalPromoters: ["顧及然", "顧院長", "孟宏", "舒庭"],
};

/** SiteSetting.value 是自由文字，解析一律 clamp + fallback（同 sms/settings.ts）。
 *  絕不能讓 NaN 流進分潤計算——那是要發給人的錢。 */
function parseNum(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** internalShares 存 JSON 字串（只有三列、極少改，開一張表不划算）。
 *  逐項驗形：解析失敗、型別不符、比例超界（單筆 0–100%）一律回退預設，
 *  不讓壞資料默默變成 0 元分潤。 */
function parseShares(raw: string | undefined): InternalShareSetting[] {
  if (!raw) return FINANCE_SETTING_DEFAULTS.internalShares;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20)
      return FINANCE_SETTING_DEFAULTS.internalShares;
    const out: InternalShareSetting[] = [];
    for (const x of arr) {
      const name = typeof x?.name === "string" ? x.name.trim() : "";
      const ppm = Number(x?.ppm);
      if (!name || !Number.isFinite(ppm) || ppm < 0 || ppm > 1_000_000) {
        return FINANCE_SETTING_DEFAULTS.internalShares;
      }
      out.push({ name, ppm: Math.round(ppm) });
    }
    return out;
  } catch {
    return FINANCE_SETTING_DEFAULTS.internalShares;
  }
}

/** 內部人員名單存 JSON 字串陣列；解析失敗回退預設（同 parseShares 的防線思路） */
function parseNameList(raw: string | undefined): string[] {
  if (!raw) return FINANCE_SETTING_DEFAULTS.internalPromoters;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length > 50)
      return FINANCE_SETTING_DEFAULTS.internalPromoters;
    const out = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && x.length <= 30);
    return out.length > 0 ? out : FINANCE_SETTING_DEFAULTS.internalPromoters;
  } catch {
    return FINANCE_SETTING_DEFAULTS.internalPromoters;
  }
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(FINANCE_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const D = FINANCE_SETTING_DEFAULTS;
  const get = (k: keyof typeof FINANCE_SETTING_KEYS) => map.get(FINANCE_SETTING_KEYS[k]);
  return {
    invoiceTaxPpm: parseNum(get("invoiceTaxPpm"), D.invoiceTaxPpm, 0, 500_000),
    incomeTaxPpm: parseNum(get("incomeTaxPpm"), D.incomeTaxPpm, 0, 500_000),
    cardFeePpm: parseNum(get("cardFeePpm"), D.cardFeePpm, 0, 200_000),
    cardInstallFeePpm: parseNum(get("cardInstallFeePpm"), D.cardInstallFeePpm, 0, 200_000),
    atmMode: get("atmMode") === "RATE" ? "RATE" : "UNIT",
    atmUnitFee: parseNum(get("atmUnitFee"), D.atmUnitFee, 0, 1_000),
    atmFeePpm: parseNum(get("atmFeePpm"), D.atmFeePpm, 0, 200_000),
    remitUnitFee: parseNum(get("remitUnitFee"), D.remitUnitFee, 0, 1_000),
    internalShares: parseShares(get("internalShares")),
    externalSharePpm: parseNum(get("externalSharePpm"), D.externalSharePpm, 0, 1_000_000),
    internalPromoters: parseNameList(get("internalPromoters")),
  };
}

export async function setFinanceSetting(
  key: keyof typeof FINANCE_SETTING_KEYS,
  value: string,
) {
  const k = FINANCE_SETTING_KEYS[key];
  await prisma.siteSetting.upsert({
    where: { key: k },
    update: { value },
    create: { key: k, value },
  });
}
