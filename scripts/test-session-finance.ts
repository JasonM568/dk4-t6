/* 收支計算黃金測資：純函式、不碰資料庫。
 *
 * 標準答案來自使用者的真實 Excel 收支表
 *（7_23AI初階、7_29講座、8_1 AI進階課程收支表 v3.xlsx），逐格對照：
 *   0723 AI初階：收入 27,700／支出 3,072／毛利 24,628／分潤 [9851, 9851, 4926]
 *   0801 AI進階：收入 80,240／支出 8,883／毛利 71,357／分潤 [28543, 28543, 14271]
 * 這兩組數字是「算法正確」的定義。改 compute.ts 後這裡不綠 = 算錯錢。
 *
 * 跑法：npx tsx scripts/test-session-finance.ts */
import {
  computeSessionFinance,
  buildIncomeRows,
  roundNT,
  type FinanceOrderInput,
  type ManualCostInput,
} from "../src/lib/finance/compute";
import {
  FINANCE_SETTING_DEFAULTS,
  type FinanceSettings,
} from "../src/lib/finance/settings";
import { normalizePaymentMethod } from "../src/lib/finance/labels";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

const S: FinanceSettings = { ...FINANCE_SETTING_DEFAULTS };
let seq = 0;
/** 一張訂單（單一明細列）的速記 */
function order(
  method: string,
  planLabel: string,
  unitPrice: number,
  quantity = 1,
  over: Partial<FinanceOrderInput> = {},
): FinanceOrderInput {
  return {
    id: `o${seq++}`,
    paymentMethod: method,
    isRecognized: true,
    refundedAt: null,
    lines: [
      {
        planLabel,
        unitPrice,
        quantity,
        recognizedAmount: unitPrice * quantity,
        isOnsite: false,
      },
    ],
    ...over,
  };
}
const times = (n: number, f: () => FinanceOrderInput) => Array.from({ length: n }, f);

// ───────────────────────── 0723 AI初階 ─────────────────────────
{
  console.log("\n0723 AI初階（15 人）");
  const orders: FinanceOrderInput[] = [
    ...times(10, () => order("CREDIT_ONE", "複訓方案", 1500)),
    order("ATM", "複訓方案", 1500),
    ...times(3, () => order("CREDIT_ONE", "初階課程", 2800)),
    order("ATM", "初階課程（綜合認列）", 2800),
  ];
  // 手填支出（Excel 上非自動的列）：外部分潤（講師抽成）＋逐筆匯費
  const manualCosts: ManualCostInput[] = [
    { kind: "EXTERNAL_SHARE", code: null, label: "講師抽成-黃OO", basisText: "認列 NT$5,600 × 10%", basisAmount: 5600, ratePpm: 100_000, unitAmount: null, unitCount: null, amount: roundNT((5600 * 100_000) / 1_000_000), payee: "黃OO", sortOrder: 0 },
    { kind: "FIXED", code: null, label: "詩雅講師匯費", basisText: "$15 × 1", basisAmount: null, ratePpm: null, unitAmount: 15, unitCount: 1, amount: 15, payee: null, sortOrder: 1 },
    { kind: "FIXED", code: null, label: "退費匯費", basisText: "$15 × 2", basisAmount: null, ratePpm: null, unitAmount: 15, unitCount: 2, amount: 30, payee: null, sortOrder: 2 },
    // 人工覆寫分潤匯費：Excel 上是 $15×2 = 30（兩人合併匯款），
    // 自動列會算 3 人 = 45——同 code 的人工列必須讓自動列讓位
    { kind: "RATE", code: "REMIT_FEE", label: "分潤匯費", basisText: "$15 × 2", basisAmount: null, ratePpm: null, unitAmount: 15, unitCount: 2, amount: 30, payee: null, sortOrder: 3 },
  ];
  const r = computeSessionFinance({
    orders,
    manualCosts,
    shares: [
      { payeeName: "顧院長", sharePpm: 400_000 },
      { payeeName: "孟宏", sharePpm: 400_000 },
      { payeeName: "舒庭", sharePpm: 200_000 },
    ],
    settings: S,
  });
  check("收入 27,700", r.totalIncome === 27_700, `實際 ${r.totalIncome}`);
  check("支出 3,072", r.totalCost === 3_072, `實際 ${r.totalCost}`);
  check("毛利 24,628", r.grossProfit === 24_628, `實際 ${r.grossProfit}`);
  check(
    "分潤 [9851, 9851, 4926]",
    JSON.stringify(r.shareRows.map((x) => x.amount)) === "[9851,9851,4926]",
    JSON.stringify(r.shareRows.map((x) => x.amount)),
  );
  check("分潤加總 = 毛利（本場尾差恰為 0）", r.totalShared === r.grossProfit);
  check(
    "ATM 手續費 2 筆 × $15 = 30",
    r.costRows.find((c) => c.code === "ATM_FEE")?.amount === 30,
  );
  check(
    "人工覆寫的分潤匯費（30）取代自動列（45），且只有一列",
    r.costRows.filter((c) => c.code === "REMIT_FEE").length === 1 &&
      r.costRows.find((c) => c.code === "REMIT_FEE")?.amount === 30,
    JSON.stringify(r.costRows.filter((c) => c.code === "REMIT_FEE")),
  );
  check("比例合計 100% 無警告", !r.warnings.some((w) => w.includes("比例合計")));
}

// ───────────────────────── 0801 AI進階 ─────────────────────────
{
  console.log("\n0801 AI進階");
  const orders: FinanceOrderInput[] = [
    ...times(4, () => order("CREDIT_ONE", "進階正價", 8680)),
    ...times(2, () => order("CREDIT_INSTALLMENT", "進階正價", 8680)),
    order("ATM", "進階正價", 8680),
    ...times(2, () => order("CREDIT_ONE", "複訓生方案", 3600)),
    order("CREDIT_INSTALLMENT", "複訓生方案", 3600),
    order("CREDIT_ONE", "組合方案進階部分", 8680),
  ];
  const manualCosts: ManualCostInput[] = [
    { kind: "EXTERNAL_SHARE", code: null, label: "講師推廣黃OO分潤", basisText: "(8680×2) × 10%", basisAmount: 17_360, ratePpm: 100_000, unitAmount: null, unitCount: null, amount: roundNT((17_360 * 100_000) / 1_000_000), payee: "黃OO", sortOrder: 0 },
  ];
  // 這場 Excel 沒有列分潤匯費 → 用 remitUnitFee=0 的設定重現該場
  const r = computeSessionFinance({
    orders,
    manualCosts,
    shares: [
      { payeeName: "顧院長", sharePpm: 400_000 },
      { payeeName: "孟宏", sharePpm: 400_000 },
      { payeeName: "舒庭", sharePpm: 200_000 },
    ],
    settings: { ...S, remitUnitFee: 0 },
  });
  check("收入 80,240（6 種方案×付款方式）", r.totalIncome === 80_240, `實際 ${r.totalIncome}`);
  // 新分組（新生/複訓 × 付款方式 × 單價）：組合方案進階部分與進階正價同為
  // 新生-信用卡單筆-8680，合併成一列 → 6 列變 5 列，總額不變
  check("收入明細 5 列（新生單筆 5 筆合併）", r.incomeRows.length === 5, `實際 ${r.incomeRows.length}`);
  check(
    "新生-信用卡單筆 8680×5 = 43,400",
    r.incomeRows[0].label === "新生-信用卡單筆" &&
      r.incomeRows[0].quantity === 5 &&
      r.incomeRows[0].amount === 43_400,
    JSON.stringify(r.incomeRows[0]),
  );
  check(
    "排序：新生（單筆→分期→ATM）→ 複訓",
    JSON.stringify(r.incomeRows.map((x) => x.label)) ===
      JSON.stringify([
        "新生-信用卡單筆",
        "新生-信用卡分期",
        "新生-ATM匯款",
        "複訓-信用卡單筆",
        "複訓-信用卡分期",
      ]),
    JSON.stringify(r.incomeRows.map((x) => x.label)),
  );
  check("支出 8,883", r.totalCost === 8_883, `實際 ${r.totalCost}`);
  check("毛利 71,357", r.grossProfit === 71_357, `實際 ${r.grossProfit}`);
  check(
    "分潤 [28543, 28543, 14271]",
    JSON.stringify(r.shareRows.map((x) => x.amount)) === "[28543,28543,14271]",
    JSON.stringify(r.shareRows.map((x) => x.amount)),
  );
  check(
    "信用卡單筆手續費 50,600×2% = 1,012",
    r.costRows.find((c) => c.code === "CARD_FEE")?.amount === 1_012,
  );
  check(
    "信用卡分期手續費 20,960×2.4% = 503",
    r.costRows.find((c) => c.code === "CARD_INSTALLMENT_FEE")?.amount === 503,
  );
  // 尾差不變量：|毛利 − 分潤加總| ≤ 分潤人數（逐列 round 的理論上界）
  check(
    "尾差 ≤ 分潤人數",
    Math.abs(r.grossProfit - r.totalShared) <= r.shareRows.length,
  );
}

// ───────────────────────── 規則不變量 ─────────────────────────
{
  console.log("\n規則不變量");

  // roundNT 與 Excel ROUND 的負數行為
  check("roundNT(-0.5) = -1（Excel 語意，Math.round 會給 0）", roundNT(-0.5) === -1);
  check("roundNT(0.5) = 1", roundNT(0.5) === 1);
  check("roundNT(-2.4) = -2", roundNT(-2.4) === -2);

  // 負毛利：照算、不歸零
  const neg = computeSessionFinance({
    orders: [order("CREDIT_ONE", "測試", 1000)],
    manualCosts: [
      { kind: "FIXED", code: null, label: "場地費", basisText: null, basisAmount: null, ratePpm: null, unitAmount: null, unitCount: null, amount: 5000, payee: null, sortOrder: 0 },
    ],
    shares: [
      { payeeName: "A", sharePpm: 500_000 },
      { payeeName: "B", sharePpm: 500_000 },
    ],
    settings: { ...S, remitUnitFee: 0 },
  });
  check("負毛利照算（不歸零）", neg.grossProfit < 0, `毛利 ${neg.grossProfit}`);
  check(
    "負毛利分潤為負（分攤虧損）",
    neg.shareRows.every((x) => x.amount < 0),
    JSON.stringify(neg.shareRows.map((x) => x.amount)),
  );
  check("負毛利有紅字警告", neg.warnings.some((w) => w.includes("毛利為負")));

  // 比例 ≠ 100%：不擋、不正規化、只警告
  const ninety = computeSessionFinance({
    orders: [order("CREDIT_ONE", "測試", 10_000)],
    manualCosts: [],
    shares: [{ payeeName: "講師", sharePpm: 900_000 }],
    settings: { ...S, remitUnitFee: 0 },
  });
  check(
    "比例 90% 不自動補足",
    ninety.shareRows[0].amount === roundNT(ninety.grossProfit * 0.9),
  );
  check("比例 90% 有警告", ninety.warnings.some((w) => w.includes("比例合計 90%")));

  // 退款與不認列的訂單不進收入
  const { totalIncome } = buildIncomeRows([
    order("CREDIT_ONE", "正常", 1000),
    order("CREDIT_ONE", "退款", 1000, 1, { refundedAt: new Date().toISOString() }),
    order("CREDIT_ONE", "暫不認列", 1000, 1, { isRecognized: false }),
  ]);
  check("退款/不認列不進收入", totalIncome === 1000, `實際 ${totalIncome}`);

  // 認列金額 ≠ 付款金額：收入吃 recognizedAmount
  const combo = buildIncomeRows([
    {
      id: "c1",
      paymentMethod: "CREDIT_ONE",
      isRecognized: true,
      refundedAt: null,
      lines: [
        { planLabel: "組合方案進階部分", unitPrice: 15_480, quantity: 1, recognizedAmount: 8_680, isOnsite: false },
      ],
    },
  ]);
  check("組合方案只計認列金額 8,680", combo.totalIncome === 8_680, `實際 ${combo.totalIncome}`);

  // UNKNOWN 付款方式要有警告
  const unk = computeSessionFinance({
    orders: [order("UNKNOWN", "測試", 1000)],
    manualCosts: [],
    shares: [],
    settings: S,
  });
  check("UNKNOWN 付款方式有警告", unk.warnings.some((w) => w.includes("付款方式未知")));

  // 付款方式正規化（值域來自真實匯出檔）
  const cases: [string, string, number][] = [
    ["信用卡", "CREDIT_ONE", 0],
    ["信用卡線上付款", "CREDIT_ONE", 0],
    ["信用卡分3期", "CREDIT_INSTALLMENT", 3],
    ["單筆滿3000可信用卡分3期", "CREDIT_INSTALLMENT", 3],
    ["ATM匯款轉帳", "ATM", 0],
    ["", "UNKNOWN", 0],
  ];
  for (const [raw, method, inst] of cases) {
    const r = normalizePaymentMethod(raw);
    check(
      `正規化「${raw || "(空)"}」→ ${method}${inst ? `（${inst}期）` : ""}`,
      r.method === method && r.installments === inst,
      `實際 ${r.method}/${r.installments}`,
    );
  }
}

console.log(`\n通過 ${pass}、失敗 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
