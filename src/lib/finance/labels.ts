// 收支模組的常數與標籤（純模組，無 server-only）。
// 常數放這裡而不是 actions/session-finance.ts："use server" 檔案只能匯出
// async 函式，export 常數會讓整個路由群組載入時整頁失敗（2026-08-26 事故）。

/** 付款方式正規化碼 → 收支表顯示名（沿用他 Excel 的用詞） */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CREDIT_ONE: "信用卡單筆",
  CREDIT_INSTALLMENT: "信用卡分期",
  ATM: "ATM匯款",
  CASH: "現場付款",
  OTHER: "其他",
  UNKNOWN: "付款方式未知",
};

/** 1shop「金流」欄原文 → 正規化碼。
 *
 *  實測值域（2026-08 六份匯出檔 166 筆）：
 *    信用卡 81／信用卡線上付款 58／信用卡分3期 11／ATM匯款轉帳 8／
 *    單筆滿3000可信用卡分3期 2／空值 6
 *  「分期」有兩種寫法，所以**先判分期再判信用卡**，順序不能反；
 *  原文一律另存 paymentMethodRaw，1shop 改字時可重新對照不必重匯。 */
export function normalizePaymentMethod(raw: string | null | undefined): {
  method: string;
  installments: number;
} {
  const t = (raw ?? "").trim();
  if (!t) return { method: "UNKNOWN", installments: 0 };
  const m = t.match(/分\s*(\d+)\s*期/);
  if (m) return { method: "CREDIT_INSTALLMENT", installments: Number(m[1]) };
  if (t.includes("分期")) return { method: "CREDIT_INSTALLMENT", installments: 0 };
  if (t.includes("信用卡") || t.toLowerCase().includes("credit"))
    return { method: "CREDIT_ONE", installments: 0 };
  if (t.includes("ATM") || t.includes("匯款") || t.includes("轉帳"))
    return { method: "ATM", installments: 0 };
  if (t.includes("現金") || t.includes("現場")) return { method: "CASH", installments: 0 };
  return { method: "OTHER", installments: 0 };
}

/** 收入分類：新生／複訓（收支表收入區塊的第一層分組）。
 *  自動判定沿用全站同一條規則：產品名含「複訓」（session-roster.isRetrainProduct）。
 *  line.studentType 有值＝人工覆寫，一律以人工為準。 */
export const STUDENT_TYPE_LABEL: Record<string, string> = {
  NEW: "新生",
  RETRAIN: "複訓",
};

export function deriveStudentType(
  productRaw: string,
  override: string | null | undefined,
): "NEW" | "RETRAIN" {
  if (override === "NEW" || override === "RETRAIN") return override;
  return productRaw.includes("複訓") ? "RETRAIN" : "NEW";
}

/** 收入列排序：新生在前、複訓在後；同類內依付款方式（單筆→分期→ATM→其他） */
export const STUDENT_TYPE_ORDER: Record<string, number> = { NEW: 0, RETRAIN: 1 };
export const PAYMENT_METHOD_ORDER: Record<string, number> = {
  CREDIT_ONE: 0,
  CREDIT_INSTALLMENT: 1,
  ATM: 2,
  CASH: 3,
  OTHER: 4,
  UNKNOWN: 5,
};

/** 自動費率支出的科目碼（SessionCost.code） */
export const RATE_COST_CODES = [
  "INVOICE_TAX",
  "INCOME_TAX",
  "CARD_FEE",
  "CARD_INSTALLMENT_FEE",
  "ATM_FEE",
  "REMIT_FEE",
] as const;
export type RateCostCode = (typeof RATE_COST_CODES)[number];

export const RATE_COST_LABEL: Record<RateCostCode, string> = {
  INVOICE_TAX: "發票稅金",
  INCOME_TAX: "營所稅",
  CARD_FEE: "信用卡手續費",
  CARD_INSTALLMENT_FEE: "信用卡分期手續費",
  ATM_FEE: "ATM 轉帳手續費",
  REMIT_FEE: "分潤匯費",
};

/** 手填成本科目的建議清單（下拉快選用；仍可自由輸入其他名目） */
export const FIXED_COST_SUGGESTIONS = [
  "場地費",
  "餐費（便當）",
  "講義印刷費",
  "交通車馬費",
  "廣告費",
  "講師費",
  "雜支",
  "其他",
] as const;

/** ppm → 顯示字串：20000 → "2%"、24000 → "2.4%" */
export function formatPpm(ppm: number): string {
  const pct = ppm / 10_000;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1).replace(/\.0$/, "")}%`;
}

export const FINANCE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "編製中",
  LOCKED: "已結算",
};
