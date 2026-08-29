import { prisma } from "@/lib/db";

// 付款方式設定（存 SiteSetting，後台「訂單管理 → 付款設定」維護）。
// 建單時注入 UPP 的支付工具參數——PAYUNi 規則：帶了任一工具參數即白名單模式，
// 只顯示帶 =1 的項目；所以這裡的開關就是付款頁上會出現什麼。
//
// 預設值＝Jason 指定的上線配置：只留信用卡＋ATM，Apple/Google Pay 關閉，
// 分期關閉。讀取失敗回預設值，設定表壞掉不能擋結帳。

const KEYS = {
  credit: "payment:credit",
  atm: "payment:atm",
  cvs: "payment:cvs",
  applePay: "payment:applepay",
  googlePay: "payment:googlepay",
  instEnabled: "payment:inst_enabled",
  instOptions: "payment:inst_options", // 逗號分隔期數，例 "3,6,12"
  instMinAmount: "payment:inst_min_amount", // 分期門檻：訂單滿此金額才開放分期
} as const;

export type PaymentToolConfig = {
  credit: boolean;
  atm: boolean;
  cvs: boolean;
  applePay: boolean;
  googlePay: boolean;
  instEnabled: boolean;
  instOptions: string; // 驗證過的期數字串
  instMinAmount: number;
};

export const DEFAULT_PAY_CONFIG: PaymentToolConfig = {
  credit: true,
  atm: true,
  cvs: false,
  applePay: false,
  googlePay: false,
  instEnabled: false,
  instOptions: "3,6",
  instMinAmount: 0,
};

/** PAYUNi 支援的分期期數（依文件；實際可用依商店開通的銀行為準） */
export const INST_CHOICES = [3, 6, 9, 12, 18, 24, 30] as const;

/** 期數字串正規化：只留支援的期數、去重、由小到大；空結果回預設 */
export function normalizeInstOptions(raw: string): string {
  const set = new Set(
    raw
      .split(/[,\s]+/)
      .map((n) => Number(n))
      .filter((n) => (INST_CHOICES as readonly number[]).includes(n)),
  );
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted.join(",") : DEFAULT_PAY_CONFIG.instOptions;
}

export async function getPaymentToolConfig(): Promise<PaymentToolConfig> {
  try {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: Object.values(KEYS) } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    const bool = (k: string, dflt: boolean) => {
      const v = get(k);
      return v === undefined ? dflt : v === "1";
    };
    const minRaw = Number(get(KEYS.instMinAmount));
    const config: PaymentToolConfig = {
      credit: bool(KEYS.credit, DEFAULT_PAY_CONFIG.credit),
      atm: bool(KEYS.atm, DEFAULT_PAY_CONFIG.atm),
      cvs: bool(KEYS.cvs, DEFAULT_PAY_CONFIG.cvs),
      applePay: bool(KEYS.applePay, DEFAULT_PAY_CONFIG.applePay),
      googlePay: bool(KEYS.googlePay, DEFAULT_PAY_CONFIG.googlePay),
      instEnabled: bool(KEYS.instEnabled, DEFAULT_PAY_CONFIG.instEnabled),
      instOptions: normalizeInstOptions(get(KEYS.instOptions) ?? DEFAULT_PAY_CONFIG.instOptions),
      instMinAmount:
        Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : DEFAULT_PAY_CONFIG.instMinAmount,
    };
    // 全部關掉會讓付款頁開不出任何選項——至少保底信用卡
    if (!config.credit && !config.atm && !config.cvs && !config.applePay && !config.googlePay) {
      config.credit = true;
    }
    return config;
  } catch (e) {
    console.error("[payment] 讀取付款方式設定失敗，使用預設（信用卡+ATM）", e);
    return { ...DEFAULT_PAY_CONFIG };
  }
}

export async function setPaymentToolConfig(config: PaymentToolConfig): Promise<void> {
  const entries: [string, string][] = [
    [KEYS.credit, config.credit ? "1" : "0"],
    [KEYS.atm, config.atm ? "1" : "0"],
    [KEYS.cvs, config.cvs ? "1" : "0"],
    [KEYS.applePay, config.applePay ? "1" : "0"],
    [KEYS.googlePay, config.googlePay ? "1" : "0"],
    [KEYS.instEnabled, config.instEnabled ? "1" : "0"],
    [KEYS.instOptions, normalizeInstOptions(config.instOptions)],
    [KEYS.instMinAmount, String(Math.max(0, Math.round(config.instMinAmount)))],
  ];
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
    ),
  );
}

/** 依設定與訂單金額算出這筆交易要帶給金流的支付工具參數。
 *  分期門檻在這裡生效：金額未達門檻就不帶 CreditInst（付款頁不出現分期）。 */
export function resolvePayTools(
  config: PaymentToolConfig,
  amount: number,
): {
  credit: boolean;
  atm: boolean;
  cvs: boolean;
  applePay: boolean;
  googlePay: boolean;
  creditInstallments?: string;
} {
  const allowInst = config.instEnabled && config.credit && amount >= config.instMinAmount;
  return {
    credit: config.credit,
    atm: config.atm,
    cvs: config.cvs,
    applePay: config.applePay,
    googlePay: config.googlePay,
    ...(allowInst ? { creditInstallments: config.instOptions } : {}),
  };
}
