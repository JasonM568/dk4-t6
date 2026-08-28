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
  buildExternalShareRows,
  roundNT,
  type FinanceOrderInput,
  type ManualCostInput,
} from "../src/lib/finance/compute";
import {
  FINANCE_SETTING_DEFAULTS,
  type FinanceSettings,
} from "../src/lib/finance/settings";
import {
  attributeOrder,
  extractPromoter,
  normalizePaymentMethod,
} from "../src/lib/finance/labels";

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

// ───────────────────── 量子思維 0627 台北（最複雜的真實場） ─────────────────────
// 來源：docs/量子思維課程_6-27台北_課程收支表_v4 - 課程收支表.csv
// 涵蓋：折價造成同類型多價位列、天使長/講師外部分潤 5 筆、退費差額、
// 分潤匯費人工覆寫（$15×7 而非內部 3 人）、延期者不計收入（33 人只算 32 筆）
{
  console.log("\n量子思維 0627 台北（33 人，收入 135,660）");
  const orders: FinanceOrderInput[] = [
    ...times(10, () => order("CREDIT_ONE", "新生方案｜6/27 台北場", 5880)),
    order("CREDIT_ONE", "新生方案｜6/27 台北場(延期補差)", 3980),
    ...times(4, () => order("ATM", "新生方案｜6/27 台北場", 5880)),
    order("ATM", "新生方案｜6/27 台北場", 5580), // 洪仟瑜 分享會折價300
    order("CREDIT_ONE", "新生官網折價｜6/27 台北場", 4880), // 黃佩鈺
    order("CREDIT_INSTALLMENT", "新生方案｜6/27 台北場", 5580), // 謝幸娟 折價300分3期
    ...times(13, () => order("CREDIT_ONE", "複訓生方案｜6/27 台北場", 2380)),
    order("ATM", "複訓生方案｜6/27 台北場", 2380),
  ];
  const ext = (label: string, payee: string, basis: number) => ({
    kind: "EXTERNAL_SHARE", code: null as string | null, label, payee,
    basisText: `${basis.toLocaleString()} × 20%`, basisAmount: basis, ratePpm: 200_000,
    unitAmount: null, unitCount: null, amount: roundNT(basis * 0.2), sortOrder: 0,
  });
  const fixed = (label: string, amount: number, sortOrder: number) => ({
    kind: "FIXED", code: null as string | null, label, basisText: null, basisAmount: null,
    ratePpm: null, unitAmount: null, unitCount: null, amount, payee: null, sortOrder,
  });
  const manualCosts: ManualCostInput[] = [
    ext("天使長 鄭婕予 分潤", "鄭婕予", 5880),
    ext("天使長 楊立慧 分潤", "楊立慧", 5880),
    ext("天使長 吳旻玹 分潤", "吳旻玹", 3980),
    ext("講師 黃靖閔 分潤", "黃靖閔", 11760),
    ext("講師 高名萱 分潤", "高名萱", 5880),
    fixed("謝幸娟退費差額", 400, 5),
    fixed("場地費", 24180, 6),
    // 分潤匯費人工覆寫：$15×7（天使長+講師+退費匯款），取代自動的內部 3 人×15
    { kind: "RATE", code: "REMIT_FEE", label: "分潤匯費", basisText: "$15 × 7",
      basisAmount: null, ratePpm: null, unitAmount: 15, unitCount: 7, amount: 105,
      payee: null, sortOrder: 7 },
    fixed("午餐便當", 4760, 8),
  ];
  const r = computeSessionFinance({
    orders, manualCosts,
    shares: [
      { payeeName: "顧院長", sharePpm: 400_000 },
      { payeeName: "孟宏", sharePpm: 400_000 },
      { payeeName: "舒庭", sharePpm: 200_000 },
    ],
    settings: S,
    template: "QUANTUM", // 量子模板：手續費拆新生/複訓列（2026-08-28 拍板）
  });
  check("收入 135,660（32 筆；延期者不入列）", r.totalIncome === 135_660, `實際 ${r.totalIncome}`);
  check(
    "收入 8 列（折價不同價位各自成列）",
    r.incomeRows.length === 8,
    JSON.stringify(r.incomeRows.map((x) => `${x.label} ${x.unitPrice}×${x.quantity}`)),
  );
  // QUANTUM 模板拆列——與他的表第 3–7 列逐格對照
  check(
    "刷卡手續費-新生 67,660×2% = 1,353",
    r.costRows.find((c) => c.code === "CARD_FEE_NEW")?.amount === 1_353,
    JSON.stringify(r.costRows.filter((c) => c.isAuto).map((c) => `${c.code}=${c.amount}`)),
  );
  check(
    "刷卡手續費-複訓 30,940×2% = 619",
    r.costRows.find((c) => c.code === "CARD_FEE_RETRAIN")?.amount === 619,
  );
  check(
    "分期手續費-新生 5,580×2.4% = 134",
    r.costRows.find((c) => c.code === "CARD_INSTALLMENT_FEE_NEW")?.amount === 134,
  );
  check(
    "ATM-新生 5 筆×15 = 75",
    r.costRows.find((c) => c.code === "ATM_FEE_NEW")?.amount === 75,
  );
  check(
    "ATM-複訓 1 筆×15 = 15",
    r.costRows.find((c) => c.code === "ATM_FEE_RETRAIN")?.amount === 15,
  );
  check(
    "新生 12 位／複訓 13 位進到列名（同他的表）",
    (r.costRows.find((c) => c.code === "CARD_FEE_NEW")?.label ?? "").includes("新生 12 位") &&
      (r.costRows.find((c) => c.code === "CARD_FEE_RETRAIN")?.label ?? "").includes("複訓 13 位"),
  );
  check(
    "分潤匯費覆寫 105 生效（自動 45 讓位）",
    r.costRows.filter((c) => c.code === "REMIT_FEE").length === 1 &&
      r.costRows.find((c) => c.code === "REMIT_FEE")?.amount === 105,
  );
  check("支出 47,813", r.totalCost === 47_813, `實際 ${r.totalCost}`);
  check("毛利 87,847", r.grossProfit === 87_847, `實際 ${r.grossProfit}`);
  check(
    "分潤 [35139, 35139, 17569]",
    JSON.stringify(r.shareRows.map((x) => x.amount)) === "[35139,35139,17569]",
    JSON.stringify(r.shareRows.map((x) => x.amount)),
  );
  check("分潤加總 = 毛利（他的表也是 87,847）", r.totalShared === 87_847);
}

// ──────────────── 外部分潤自動歸屬（銷售頁推廣者／推薦人） ────────────────
// 資料型態來自高雄 8/15 真實訂單檔：銷售頁「(推廣者-XXX專用)」、
// 推薦人欄自由文字（「顧及然 院長」）。規則：推薦人優先、內部人員不分潤、只算新生
{
  console.log("\n外部分潤自動歸屬");
  const PAGE = (who: string) => `HOPE OS 初階｜AI 時代的人生升級系統 (推廣者-${who}專用)`;

  check("銷售頁抽推廣者：黃詩雅", extractPromoter(PAGE("黃詩雅")) === "黃詩雅");
  check("官方頁抽不到推廣者", extractPromoter("希望學院課程報名網") === null);
  check(
    "推薦人優先於頁主",
    JSON.stringify(attributeOrder("謝佳玲", PAGE("黃詩雅"), S.internalPromoters)) ===
      JSON.stringify({ name: "謝佳玲", via: "REFERRER" }),
  );
  check(
    "內部推薦人不分潤（顧及然 院長）",
    attributeOrder("顧及然 院長", null, S.internalPromoters) === null,
  );
  check(
    "內部頁主不分潤（陳孟宏）",
    attributeOrder(null, PAGE("陳孟宏"), S.internalPromoters) === null,
  );

  const orders: FinanceOrderInput[] = [
    // 黃詩雅頁：新生 5,880 計入、複訓 2,380 不計
    order("CREDIT_ONE", "量子思維2.0 新生方案｜8/15 高雄", 5880, 1, { salesPage: PAGE("黃詩雅") }),
    order("CREDIT_ONE", "量子思維2.0 複訓方案｜8/15 高雄", 2380, 1, { salesPage: PAGE("黃詩雅") }),
    // 孟宏頁＋推薦人謝佳玲：歸謝佳玲
    order("ATM", "量子思維2.0 新生方案｜8/15 高雄", 5880, 1, {
      salesPage: PAGE("陳孟宏"),
      referrer: "謝佳玲",
    }),
    // 孟宏頁無推薦人：內部，不產生
    order("CREDIT_ONE", "量子思維2.0 新生方案｜8/15 高雄", 5880, 1, { salesPage: PAGE("陳孟宏") }),
    // 內部推薦人：不產生
    order("CREDIT_ONE", "量子思維2.0 新生方案｜8/15 高雄", 5880, 1, { referrer: "顧院長 世華南加分會理事" }),
    // 退款訂單：不計
    order("CREDIT_ONE", "量子思維2.0 新生方案｜8/15 高雄", 5880, 1, {
      salesPage: PAGE("李憶瑄"),
      refundedAt: new Date("2026-08-20"),
      isRecognized: false,
    }),
  ];
  const ext = buildExternalShareRows(orders, S);
  check(
    "自動列：黃詩雅與謝佳玲各一列（內部/複訓/退款都不產生）",
    ext.length === 2 &&
      ext.some((c) => c.payee === "黃詩雅") &&
      ext.some((c) => c.payee === "謝佳玲"),
    JSON.stringify(ext.map((c) => `${c.payee}=${c.amount}`)),
  );
  check(
    "金額 = 新生 5,880 × 20% = 1,176（複訓 2,380 不進基數）",
    ext.find((c) => c.payee === "黃詩雅")?.amount === 1_176,
  );
  check(
    "同名人工列讓自動列讓位",
    buildExternalShareRows(orders, S, ["黃詩雅"]).every((c) => c.payee !== "黃詩雅"),
  );
  // 整條鏈：computeSessionFinance 把自動外部列算進支出
  const rr = computeSessionFinance({
    orders,
    manualCosts: [],
    shares: [{ payeeName: "顧院長", sharePpm: 1_000_000 }],
    settings: { ...S, remitUnitFee: 0 },
  });
  check(
    "自動外部分潤進支出（含 2,352）且毛利已扣",
    rr.costRows.filter((c) => c.kind === "EXTERNAL_SHARE").reduce((n, c) => n + c.amount, 0) ===
      2_352 && rr.grossProfit === rr.totalIncome - rr.totalCost,
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

// ───────────────────────── Excel 匯出（sheet.ts 與 route 共用同一份建構） ─────────────────────────
(async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { buildFinanceWorkbook } = await import("../src/lib/finance/sheet");
  console.log("\nExcel 匯出（以 0801 場驗）");

  // 重建 0801 場（同上方黃金測資）
  seq = 0;
  const orders: FinanceOrderInput[] = [
    ...times(4, () => order("CREDIT_ONE", "進階正價", 8680)),
    ...times(2, () => order("CREDIT_INSTALLMENT", "進階正價", 8680)),
    order("ATM", "進階正價", 8680),
    ...times(2, () => order("CREDIT_ONE", "複訓生方案", 3600)),
    order("CREDIT_INSTALLMENT", "複訓生方案", 3600),
    order("CREDIT_ONE", "組合方案進階部分", 8680),
  ];
  const r = computeSessionFinance({
    orders,
    manualCosts: [
      { kind: "EXTERNAL_SHARE", code: null, label: "講師推廣黃OO分潤", basisText: "(8680×2) × 10%", basisAmount: 17_360, ratePpm: 100_000, unitAmount: null, unitCount: null, amount: 1_736, payee: "黃OO", sortOrder: 0 },
    ],
    shares: [
      { payeeName: "顧院長", sharePpm: 400_000 },
      { payeeName: "孟宏", sharePpm: 400_000 },
      { payeeName: "舒庭", sharePpm: 200_000 },
    ],
    settings: { ...S, remitUnitFee: 0 },
  });
  const wb = buildFinanceWorkbook({
    title: "AI 進階課程 8/1",
    signupCount: 11,
    todayText: "2026-08-28",
    result: r,
    sharesPpmTotal: 1_000_000,
    orders: [
      {
        orderNo: "08K607111",
        buyerName: "吳宥靜",
        isRecognized: true,
        excludeReason: null,
        refundedAt: null,
        refundAmount: 0,
        lines: [{ amount: 15_480, recognizedAmount: 8_680, recognizeNote: "組合方案僅認列進階部分" }],
      },
    ],
    sourceFile: "order_2026_08_07_10_24_57.xlsx",
  });

  // 寫出再回讀：驗的是「收到檔的人看到的東西」，不是記憶體物件
  const buf = await wb.xlsx.writeBuffer();
  const rb = new ExcelJS.Workbook();
  await rb.xlsx.load(buf as ArrayBuffer);
  const ws = rb.worksheets[0];

  check("工作表名無斜線（8/1 → 8-1）", !ws.name.includes("/"), ws.name);

  // 找關鍵列
  const findRow = (label: string) => {
    for (let i = 1; i <= ws.rowCount; i++) {
      if (String(ws.getRow(i).getCell(1).value ?? "").startsWith(label)) return ws.getRow(i);
    }
    return null;
  };
  const cellNum = (c: { value: unknown }) => {
    const v = c.value;
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "result" in v) return (v as { result: number }).result;
    return NaN;
  };
  const cellFormula = (c: { value: unknown }) => {
    const v = c.value;
    return v && typeof v === "object" && "formula" in v ? (v as { formula: string }).formula : null;
  };

  const incomeTotal = findRow("收入合計");
  check("收入合計 = 80,240 且為 SUM 公式",
    !!incomeTotal && cellNum(incomeTotal.getCell(5)) === 80_240 &&
      (cellFormula(incomeTotal.getCell(5)) ?? "").startsWith("SUM("),
    incomeTotal ? `${cellNum(incomeTotal.getCell(5))} / ${cellFormula(incomeTotal.getCell(5))}` : "列不存在");

  const costTotal = findRow("支出合計");
  check("支出合計 = 8,883（SUM 公式）",
    !!costTotal && cellNum(costTotal.getCell(5)) === 8_883 &&
      (cellFormula(costTotal.getCell(5)) ?? "").startsWith("SUM("));

  const profit = findRow("毛利");
  check("毛利 = 71,357（收入-支出公式）",
    !!profit && cellNum(profit.getCell(5)) === 71_357 && !!cellFormula(profit.getCell(5)));

  // 分潤列：金額是 ROUND(毛利×比例) 公式、比例欄是 0.4
  let shareOk = false;
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (String(row.getCell(2).value ?? "") === "顧院長") {
      shareOk =
        cellNum(row.getCell(5)) === 28_543 &&
        (cellFormula(row.getCell(5)) ?? "").startsWith("ROUND(") &&
        Number(row.getCell(4).value) === 0.4;
      break;
    }
  }
  check("顧院長列：0.4 比例＋ROUND 公式＋28,543", shareOk);

  // 底部例外說明含認列調整與資料來源
  const allText: string[] = [];
  for (let i = 1; i <= ws.rowCount; i++) allText.push(String(ws.getRow(i).getCell(1).value ?? ""));
  check("底部含認列例外說明", allText.some((t) => t.includes("組合方案僅認列進階部分")));
  check("底部含資料來源", allText.some((t) => t.includes("order_2026_08_07_10_24_57.xlsx")));

  console.log(`\n（含匯出）通過 ${pass}、失敗 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
