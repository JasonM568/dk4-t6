// 場次收支的計算核心：純函式、不 import server-only、不碰 prisma
//（同 session-roster.ts 的定位，讓 tsx 能直測——這裡算的是要發給人的錢，
// 黃金測資對照真實 Excel 的能力比什麼都重要）。
//
// 公式鏈（與使用者 2026 年真實收支表逐格對過，0723 與 0801 兩場全數吻合到元）：
//   Step 1 收入 = Σ line.recognizedAmount（isRecognized 且未退款的訂單）
//   Step 2 自動費率支出（發票稅金/營所稅/刷卡/分期/ATM/分潤匯費）
//   Step 3 外部分潤（毛收 × %）——也是支出，先扣
//   Step 4 總支出 = 費率型 + 手填型 + 外部分潤 全含
//   Step 5 毛利 = 收入 − 總支出
//   Step 6 內部分潤 = 毛利 × 各人比例
//
// ⚠️ 循環依賴陷阱：「分潤匯費」的筆數 = 內部分潤人數。它只吃「人數」不吃「金額」，
// 所以能在 Step 2 就算完。千萬不要改成吃分潤金額或挪到 Step 6 之後——
// 匯費→總支出→毛利→分潤→匯費就成環了。

import type { FinanceSettings } from "./settings";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHOD_ORDER,
  RATE_COST_LABEL,
  STUDENT_TYPE_LABEL,
  STUDENT_TYPE_ORDER,
  attributeOrder,
  deriveStudentType,
  formatPpm,
  type FinanceTemplate,
} from "./labels";

/** Excel ROUND(x,0) 語意：half away from zero。
 *  不能用 Math.round——負數時 JS 是 half up（往 +∞），Excel 是遠離 0，
 *  負毛利場次的分潤會因此差 1 元且永遠找不到在哪。 */
export const roundNT = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

// ── 輸入型別（POJO，呼叫端從 prisma 撈好傳進來） ──

export type FinanceOrderInput = {
  id: string;
  paymentMethod: string; // CREDIT_ONE / CREDIT_INSTALLMENT / ATM / CASH / OTHER / UNKNOWN
  isRecognized: boolean;
  refundedAt: Date | string | null;
  buyerName?: string; // 收入列尾的名單欄（他的 Excel 每列都附學員名字）
  // 外部分潤歸屬（1shop 原文；沒有就不產生自動分潤建議）
  salesPage?: string | null;
  referrer?: string | null;
  lines: {
    planLabel: string;
    productRaw?: string; // 新生/複訓自動判定用（含「複訓」＝複訓）
    studentType?: string | null; // 人工覆寫：NEW / RETRAIN；null = 自動判定
    unitPrice: number;
    quantity: number;
    recognizedAmount: number;
    isOnsite: boolean;
  }[];
};

/** 手填／覆寫的支出列（isAuto=false，重算時原樣保留） */
export type ManualCostInput = {
  id?: string;
  kind: string; // FIXED / EXTERNAL_SHARE / RATE（人工覆寫的費率列）
  code: string | null;
  label: string;
  basisText: string | null;
  basisAmount: number | null;
  ratePpm: number | null;
  unitAmount: number | null;
  unitCount: number | null;
  amount: number;
  payee: string | null;
  note?: string | null;
  sortOrder: number;
};

export type ShareInput = { payeeName: string; sharePpm: number };

// ── 輸出型別 ──

export type IncomeRow = {
  studentType: string; // NEW / RETRAIN
  label: string; // 「新生-信用卡單筆」（收支表項目欄）
  paymentMethod: string;
  methodLabel: string;
  unitPrice: number;
  quantity: number;
  amount: number; // Σ recognizedAmount（認列後）
  hasOnsite: boolean;
  names: string[]; // 該列的學員名單
};

export type CostRow = {
  id?: string;
  kind: string;
  code: string | null;
  label: string;
  basisText: string | null;
  ratePpm: number | null;
  amount: number;
  isAuto: boolean;
  payee: string | null;
  note: string | null;
  sortOrder: number;
};

export type ShareRow = {
  payeeName: string;
  sharePpm: number;
  basisText: string;
  amount: number;
};

export type FinanceResult = {
  incomeRows: IncomeRow[];
  totalIncome: number;
  costRows: CostRow[];
  totalCost: number;
  grossProfit: number;
  shareRows: ShareRow[];
  totalShared: number; // 內部分潤加總（逐列 round 後相加，可能與毛利有尾差）
  warnings: string[]; // 送出前必須讓人看到的問題（UNKNOWN 付款方式、比例≠100%…）
};

/** 收入明細：GROUP BY (新生/複訓, 付款方式, 單價)。
 *  第一層是學員類型（使用者指定的收支表格式），付款方式細分 單筆/分期/ATM；
 *  單價留在鍵裡——同類型不同價（早鳥 vs 原價）分列，「每人單價」欄才有意義。
 *  「複訓×2＋新生×1」一張訂單會正確落在兩列（金額跟明細列走，不跟訂單走）。 */
export function buildIncomeRows(orders: FinanceOrderInput[]): {
  rows: IncomeRow[];
  totalIncome: number;
  unknownMethodCount: number;
} {
  const map = new Map<string, IncomeRow>();
  let unknownMethodCount = 0;
  for (const o of orders) {
    if (!o.isRecognized || o.refundedAt) continue; // 不認列/已退款：收入一律不計
    if (o.paymentMethod === "UNKNOWN") unknownMethodCount++;
    for (const l of o.lines) {
      const st = deriveStudentType(l.productRaw ?? l.planLabel, l.studentType);
      const key = `${st} ${o.paymentMethod} ${l.unitPrice}`;
      const cur = map.get(key);
      if (cur) {
        cur.quantity += l.quantity;
        cur.amount += l.recognizedAmount;
        cur.hasOnsite ||= l.isOnsite;
        if (o.buyerName && !cur.names.includes(o.buyerName)) cur.names.push(o.buyerName);
      } else {
        const methodLabel = PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod;
        map.set(key, {
          studentType: st,
          label: `${STUDENT_TYPE_LABEL[st]}-${methodLabel}`,
          paymentMethod: o.paymentMethod,
          methodLabel,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          amount: l.recognizedAmount,
          hasOnsite: l.isOnsite,
          names: o.buyerName ? [o.buyerName] : [],
        });
      }
    }
  }
  // 新生在前、複訓在後；同類內 單筆→分期→ATM；同方式高價在前
  const rows = [...map.values()].sort(
    (a, b) =>
      (STUDENT_TYPE_ORDER[a.studentType] ?? 9) - (STUDENT_TYPE_ORDER[b.studentType] ?? 9) ||
      (PAYMENT_METHOD_ORDER[a.paymentMethod] ?? 9) -
        (PAYMENT_METHOD_ORDER[b.paymentMethod] ?? 9) ||
      b.unitPrice - a.unitPrice,
  );
  // 收入是整數相加，不經過浮點；totalIncome 不需 round
  const totalIncome = rows.reduce((n, r) => n + r.amount, 0);
  return { rows, totalIncome, unknownMethodCount };
}

/** 各付款方式的認列收入與訂單筆數（手續費基數）。
 *  筆數以「訂單」計不以明細列計——ATM $15/筆 收的是每筆轉帳的手續費。 */
function sumByMethod(orders: FinanceOrderInput[]) {
  const amount = new Map<string, number>();
  const count = new Map<string, number>();
  for (const o of orders) {
    if (!o.isRecognized || o.refundedAt) continue;
    const a = o.lines.reduce((n, l) => n + l.recognizedAmount, 0);
    amount.set(o.paymentMethod, (amount.get(o.paymentMethod) ?? 0) + a);
    count.set(o.paymentMethod, (count.get(o.paymentMethod) ?? 0) + 1);
  }
  return { amount, count };
}

const fmtNT = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;

/** 各(付款方式 × 新生/複訓)的認列收入、人數（Σ quantity）、訂單筆數。
 *  QUANTUM 模板拆列用。訂單筆數的桶＝該訂單認列金額最大的那一列的類型
 *  （混合訂單極罕見；取最大列可避免一張訂單在兩桶都算一次轉帳手續費）。 */
function sumByMethodType(orders: FinanceOrderInput[]) {
  const amount = new Map<string, number>();
  const qty = new Map<string, number>();
  const count = new Map<string, number>();
  for (const o of orders) {
    if (!o.isRecognized || o.refundedAt) continue;
    let bestType = "NEW";
    let bestAmount = -1;
    for (const l of o.lines) {
      const st = deriveStudentType(l.productRaw ?? l.planLabel, l.studentType);
      const key = `${o.paymentMethod}|${st}`;
      amount.set(key, (amount.get(key) ?? 0) + l.recognizedAmount);
      qty.set(key, (qty.get(key) ?? 0) + l.quantity);
      if (l.recognizedAmount > bestAmount) {
        bestAmount = l.recognizedAmount;
        bestType = st;
      }
    }
    const ck = `${o.paymentMethod}|${bestType}`;
    count.set(ck, (count.get(ck) ?? 0) + 1);
  }
  return { amount, qty, count };
}

/** 自動費率支出（Step 2）。加總順序鐵則：**逐列先 round、再相加**——
 *  Excel 每一格都有 ROUND(...,0)，先加浮點再 round 會系統性差 1~2 元。
 *
 *  template="QUANTUM" 時刷卡/分期/ATM 手續費拆「新生/複訓」列（對照他的量子
 *  收支表：信用卡手續費-新生12位／-複訓13位…），金額總和與合併模式相同
 *  （基數本來就是逐(方式×類型)的整數金額，各自 × 費率再 round）。 */
export function buildAutoRateCosts(
  orders: FinanceOrderInput[],
  totalIncome: number,
  settings: FinanceSettings,
  internalShareCount: number,
  template: FinanceTemplate = "GENERAL",
): CostRow[] {
  const { amount, count } = sumByMethod(orders);
  const rows: CostRow[] = [];
  let sort = 0;
  const push = (row: Omit<CostRow, "kind" | "isAuto" | "payee" | "note" | "sortOrder">) => {
    // 金額為 0 的自動列不建（他的 Excel「零筆數的列不顯示」同一慣例）
    if (row.amount === 0) return;
    rows.push({ ...row, kind: "RATE", isAuto: true, payee: null, note: null, sortOrder: sort++ });
  };

  push({
    code: "INVOICE_TAX",
    label: RATE_COST_LABEL.INVOICE_TAX,
    basisText: `總收入 ${fmtNT(totalIncome)} × ${formatPpm(settings.invoiceTaxPpm)}`,
    ratePpm: settings.invoiceTaxPpm,
    amount: roundNT((totalIncome * settings.invoiceTaxPpm) / 1_000_000),
  });
  push({
    code: "INCOME_TAX",
    label: RATE_COST_LABEL.INCOME_TAX,
    basisText: `總收入 ${fmtNT(totalIncome)} × ${formatPpm(settings.incomeTaxPpm)}`,
    ratePpm: settings.incomeTaxPpm,
    amount: roundNT((totalIncome * settings.incomeTaxPpm) / 1_000_000),
  });

  if (template === "QUANTUM") {
    // 拆列模式：新生三列在前、複訓三列在後（他的量子表列序）
    const mt = sumByMethodType(orders);
    for (const st of ["NEW", "RETRAIN"] as const) {
      const stLabel = STUDENT_TYPE_LABEL[st];
      const cardOne = mt.amount.get(`CREDIT_ONE|${st}`) ?? 0;
      push({
        code: `CARD_FEE_${st}`,
        label: `${RATE_COST_LABEL.CARD_FEE}-${stLabel} ${mt.qty.get(`CREDIT_ONE|${st}`) ?? 0} 位`,
        basisText: `信用卡單筆 ${fmtNT(cardOne)} × ${formatPpm(settings.cardFeePpm)}`,
        ratePpm: settings.cardFeePpm,
        amount: roundNT((cardOne * settings.cardFeePpm) / 1_000_000),
      });
      const cardInstall = mt.amount.get(`CREDIT_INSTALLMENT|${st}`) ?? 0;
      push({
        code: `CARD_INSTALLMENT_FEE_${st}`,
        label: `${RATE_COST_LABEL.CARD_INSTALLMENT_FEE}-${stLabel} ${mt.qty.get(`CREDIT_INSTALLMENT|${st}`) ?? 0} 位`,
        basisText: `信用卡分期 ${fmtNT(cardInstall)} × ${formatPpm(settings.cardInstallFeePpm)}`,
        ratePpm: settings.cardInstallFeePpm,
        amount: roundNT((cardInstall * settings.cardInstallFeePpm) / 1_000_000),
      });
      const atmAmount = mt.amount.get(`ATM|${st}`) ?? 0;
      const atmCount = mt.count.get(`ATM|${st}`) ?? 0;
      if (settings.atmMode === "UNIT") {
        push({
          code: `ATM_FEE_${st}`,
          label: `${RATE_COST_LABEL.ATM_FEE}-${stLabel} ${mt.qty.get(`ATM|${st}`) ?? 0} 位`,
          basisText: `ATM ${atmCount} 筆 × $${settings.atmUnitFee}`,
          ratePpm: null,
          amount: atmCount * settings.atmUnitFee,
        });
      } else {
        push({
          code: `ATM_FEE_${st}`,
          label: `${RATE_COST_LABEL.ATM_FEE}-${stLabel}`,
          basisText: `ATM ${fmtNT(atmAmount)} × ${formatPpm(settings.atmFeePpm)}`,
          ratePpm: settings.atmFeePpm,
          amount: roundNT((atmAmount * settings.atmFeePpm) / 1_000_000),
        });
      }
    }
  } else {
    const cardOne = amount.get("CREDIT_ONE") ?? 0;
    push({
      code: "CARD_FEE",
      label: RATE_COST_LABEL.CARD_FEE,
      basisText: `信用卡單筆 ${fmtNT(cardOne)} × ${formatPpm(settings.cardFeePpm)}`,
      ratePpm: settings.cardFeePpm,
      amount: roundNT((cardOne * settings.cardFeePpm) / 1_000_000),
    });

    const cardInstall = amount.get("CREDIT_INSTALLMENT") ?? 0;
    push({
      code: "CARD_INSTALLMENT_FEE",
      label: RATE_COST_LABEL.CARD_INSTALLMENT_FEE,
      basisText: `信用卡分期 ${fmtNT(cardInstall)} × ${formatPpm(settings.cardInstallFeePpm)}`,
      ratePpm: settings.cardInstallFeePpm,
      amount: roundNT((cardInstall * settings.cardInstallFeePpm) / 1_000_000),
    });

    const atmAmount = amount.get("ATM") ?? 0;
    const atmCount = count.get("ATM") ?? 0;
    if (settings.atmMode === "UNIT") {
      push({
        code: "ATM_FEE",
        label: RATE_COST_LABEL.ATM_FEE,
        basisText: `ATM ${atmCount} 筆 × $${settings.atmUnitFee}`,
        ratePpm: null,
        amount: atmCount * settings.atmUnitFee,
      });
    } else {
      push({
        code: "ATM_FEE",
        label: RATE_COST_LABEL.ATM_FEE,
        basisText: `ATM ${fmtNT(atmAmount)} × ${formatPpm(settings.atmFeePpm)}`,
        ratePpm: settings.atmFeePpm,
        amount: roundNT((atmAmount * settings.atmFeePpm) / 1_000_000),
      });
    }
  }

  // 分潤匯費：筆數 = 內部分潤人數（見檔頭的循環依賴說明——只吃人數，不吃金額）
  push({
    code: "REMIT_FEE",
    label: RATE_COST_LABEL.REMIT_FEE,
    basisText: `$${settings.remitUnitFee} × ${internalShareCount} 筆`,
    ratePpm: null,
    amount: internalShareCount * settings.remitUnitFee,
  });

  return rows;
}

/** 外部分潤自動建議列（Step 3）。歸屬：推薦人優先、其次銷售頁「推廣者-XXX專用」；
 *  內部人員（settings.internalPromoters）不產生。基數＝該人歸屬訂單的**新生**
 *  認列金額（複訓不計、退款/不認列不計）——「非內部人員可認列分潤金額是新生費用」。
 *  excludePayees：本場已有同名人工外部分潤列 → 自動列讓位（同費率列 override 慣例）。 */
export function buildExternalShareRows(
  orders: FinanceOrderInput[],
  settings: FinanceSettings,
  excludePayees: string[] = [],
): CostRow[] {
  const clean = (s: string) => s.replace(/\s+/g, "");
  const excluded = new Set(excludePayees.map(clean));
  const acc = new Map<string, { qty: number; amount: number; via: Set<string> }>();
  for (const o of orders) {
    if (!o.isRecognized || o.refundedAt) continue;
    const attr = attributeOrder(o.referrer, o.salesPage, settings.internalPromoters);
    if (!attr || excluded.has(clean(attr.name))) continue;
    for (const l of o.lines) {
      const st = deriveStudentType(l.productRaw ?? l.planLabel, l.studentType);
      if (st !== "NEW") continue; // 外部分潤只認新生費用
      const cur = acc.get(attr.name) ?? { qty: 0, amount: 0, via: new Set<string>() };
      cur.qty += l.quantity;
      cur.amount += l.recognizedAmount;
      cur.via.add(attr.via === "REFERRER" ? "推薦人" : "銷售頁");
      acc.set(attr.name, cur);
    }
  }
  const rows: CostRow[] = [];
  let sort = 0;
  for (const [name, a] of [...acc.entries()].sort((x, y) => y[1].amount - x[1].amount)) {
    if (a.amount === 0) continue;
    rows.push({
      kind: "EXTERNAL_SHARE",
      code: `EXT_SHARE:${name}`,
      label: `${name} 分潤`,
      basisText: `新生 ${a.qty} 位 ${fmtNT(a.amount)} × ${formatPpm(settings.externalSharePpm)}（${[...a.via].join("＋")}）`,
      ratePpm: settings.externalSharePpm,
      amount: roundNT((a.amount * settings.externalSharePpm) / 1_000_000),
      isAuto: true,
      payee: name,
      note: null,
      sortOrder: sort++,
    });
  }
  return rows;
}

/** 完整結算（Step 1–6）。
 *  manualCosts = 資料庫裡 isAuto=false 的列（手填成本、外部分潤、人工覆寫的費率列），
 *  重算時原樣保留；自動費率列一律重建。 */
export function computeSessionFinance(input: {
  orders: FinanceOrderInput[];
  manualCosts: ManualCostInput[];
  shares: ShareInput[];
  settings: FinanceSettings;
  template?: FinanceTemplate; // 預設 GENERAL（合併手續費列）；QUANTUM 拆新生/複訓
}): FinanceResult {
  const { orders, manualCosts, shares, settings } = input;
  const template = input.template ?? "GENERAL";
  const warnings: string[] = [];

  // Step 1 收入
  const { rows: incomeRows, totalIncome, unknownMethodCount } = buildIncomeRows(orders);
  if (unknownMethodCount > 0) {
    warnings.push(
      `有 ${unknownMethodCount} 筆訂單付款方式未知，信用卡／ATM 手續費的計算基礎不完整`,
    );
  }

  // Step 2 自動費率支出（外部分潤在 manualCosts 裡，屬人工建立）。
  // 人工覆寫優先：manualCosts 若已有同 code 的列（例：兩人合併匯款所以
  // 分潤匯費只有 2 筆、分享會舊版 ATM 用金額×1%），自動列讓位不重複產生。
  const overriddenCodes = new Set(
    manualCosts.map((c) => c.code).filter((c): c is string => !!c),
  );
  const autoRows = buildAutoRateCosts(orders, totalIncome, settings, shares.length, template)
    .filter((r) => !r.code || !overriddenCodes.has(r.code));

  // Step 3 外部分潤自動建議：同名人工列（payee 相同）讓自動列讓位——
  // 人工調過費率/金額後，重匯與重算都不會再冒出第二列
  const manualExternalPayees = manualCosts
    .filter((c) => c.kind === "EXTERNAL_SHARE" && c.payee)
    .map((c) => c.payee as string);
  const externalAutoRows = buildExternalShareRows(orders, settings, manualExternalPayees);

  // Step 3+4 支出合併：自動列在前、手填列照 sortOrder 在後（匯出列序即此序）
  const manualRows: CostRow[] = manualCosts
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      code: c.code,
      label: c.label,
      basisText: c.basisText,
      ratePpm: c.ratePpm,
      amount: c.amount,
      isAuto: false,
      payee: c.payee,
      note: c.note ?? null,
      sortOrder: c.sortOrder,
    }));
  const costRows = [...autoRows, ...externalAutoRows, ...manualRows];
  const totalCost = costRows.reduce((n, r) => n + r.amount, 0);

  // Step 5 毛利：允許負數。歸零會讓「支出 > 收入」在報表上消失
  const grossProfit = totalIncome - totalCost;
  if (grossProfit < 0) {
    warnings.push(`本場毛利為負（${fmtNT(grossProfit)}），內部分潤將為負數（分攤虧損）`);
  }

  // Step 6 內部分潤：逐列 round。不做尾差調整——他的 Excel 也是逐格 ROUND、
  // 也有尾差，調了反而對不上
  const shareRows: ShareRow[] = shares.map((s) => ({
    payeeName: s.payeeName,
    sharePpm: s.sharePpm,
    basisText: `毛利 × ${formatPpm(s.sharePpm)}`,
    amount: roundNT((grossProfit * s.sharePpm) / 1_000_000),
  }));
  const totalShared = shareRows.reduce((n, r) => n + r.amount, 0);

  const totalPpm = shares.reduce((n, s) => n + s.sharePpm, 0);
  if (shares.length > 0 && totalPpm !== 1_000_000) {
    // 不擋不自動正規化：微型講座就是單一講師 100%，也可能刻意留比例給公司
    const un = grossProfit - roundNT((grossProfit * totalPpm) / 1_000_000);
    warnings.push(
      `內部分潤比例合計 ${formatPpm(totalPpm)}（未分配約 ${fmtNT(un)}）`,
    );
  }

  return {
    incomeRows,
    totalIncome,
    costRows,
    totalCost,
    grossProfit,
    shareRows,
    totalShared,
    warnings,
  };
}
