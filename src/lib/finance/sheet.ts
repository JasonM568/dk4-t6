import ExcelJS from "exceljs";
import type { FinanceResult } from "./compute";
import { formatPpm } from "./labels";

// 收支表 Excel 建構（純函式、不碰 prisma、不含權限）：
// route 與測試共用同一份，測試才驗得到「使用者實際拿到的檔案」。
// 版面 1:1 復刻使用者的現行收支表（三段結構、配色、ROUND 公式）。
//
// 公式取捨：
//   明細金額 = 純數值（平台是唯一真值來源）
//   合計列／毛利／分潤金額 = 公式 + result 快取——收到檔的人改一格黃色欄位
//   整表跟著動（Excel 相對平台唯一的優勢）；result 讓不重算的預覽器也有數字

const C = {
  header: "2E5090", // 大標題
  section: "4472C4", // 區塊標題
  colHead: "DCE6F1", // 欄位表頭
  input: "FFF3CD", // 黃色 = 手動填入
  total: "E8F4FD", // 合計列
  profit: "DEEAF1", // 毛利列
  zebra: "F2F7FF",
};
const fill = (color: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: color },
});

export type FinanceSheetInput = {
  title: string;
  signupCount: number;
  todayText: string; // 台北日期字串（呼叫端給，函式本身不取時間）
  result: FinanceResult;
  sharesPpmTotal: number;
  orders: {
    orderNo: string;
    buyerName: string;
    isRecognized: boolean;
    excludeReason: string | null;
    refundedAt: Date | string | null;
    refundAmount: number;
    lines: { amount: number; recognizedAmount: number; recognizeNote: string | null }[];
  }[];
  sourceFile?: string | null;
  sourceNote?: string | null;
};

export function buildFinanceWorkbook(input: FinanceSheetInput): ExcelJS.Workbook {
  const { title: sessionTitle, signupCount, todayText: today, result: r, orders } = input;
  const wb = new ExcelJS.Workbook();
  // 場次名常含「8/29」這種斜線，工作表名不允許——清掉再截 28 字（Excel 上限 31）
  const sheetName = `收支_${sessionTitle}`.replace(/[\\/?*[\]:]/g, "-").slice(0, 28);
  const ws = wb.addWorksheet(sheetName);
  ws.columns = [
    { width: 6 },
    { width: 24 },
    { width: 30 },
    { width: 12 },
    { width: 14 },
    { width: 36 },
  ];
  const font = { name: "Arial", size: 10 };

  // ── 列 1：大標題 ──
  const title = ws.addRow([`${sessionTitle}　收支表`]);
  ws.mergeCells(1, 1, 1, 6);
  title.font = { ...font, size: 14, bold: true, color: { argb: "FFFFFF" } };
  title.getCell(1).fill = fill(C.header);
  title.height = 32;

  // ── 列 2：人數＋製表日期 ──
  const meta = ws.addRow([`學員人數：${signupCount} 人`, "", `製表日期：${today}`]);
  meta.font = font;
  ws.addRow([]);

  const sectionRow = (text: string) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, 6);
    row.font = { ...font, bold: true, color: { argb: "FFFFFF" } };
    row.getCell(1).fill = fill(C.section);
    return row;
  };
  const headRow = (cells: string[]) => {
    const row = ws.addRow(cells);
    row.font = { ...font, bold: true };
    for (let i = 1; i <= 6; i++) row.getCell(i).fill = fill(C.colHead);
    return row;
  };

  // ── 一、收入明細 ──
  sectionRow("▌ 一、收入明細");
  headRow(["#", "項目", "每人單價", "數量（筆）", "金額（元）", "名單"]);
  const incomeStart = ws.rowCount + 1;
  r.incomeRows.forEach((row, i) => {
    const xr = ws.addRow([
      i + 1,
      row.label + (row.hasOnsite ? "（含現場）" : ""),
      row.unitPrice,
      row.quantity,
      // 金額 = 單價 × 數量的公式（他的原版就是 =C6*D6）；認列調整過導致
      // 金額 ≠ 單價×數量時改放純數值，公式反而會算錯
      row.amount === row.unitPrice * row.quantity
        ? { formula: `C${ws.rowCount + 1}*D${ws.rowCount + 1}`, result: row.amount }
        : row.amount,
      row.names.join("、"),
    ]);
    xr.font = font;
    if (i % 2 === 0) for (let c = 1; c <= 6; c++) xr.getCell(c).fill = fill(C.zebra);
  });
  const incomeEnd = ws.rowCount;
  const incomeTotalRow = ws.addRow([
    "收入合計",
    "",
    "",
    r.incomeRows.length
      ? {
          formula: `SUM(D${incomeStart}:D${incomeEnd})`,
          result: r.incomeRows.reduce((n, x) => n + x.quantity, 0),
        }
      : 0,
    r.incomeRows.length
      ? { formula: `SUM(E${incomeStart}:E${incomeEnd})`, result: r.totalIncome }
      : 0,
  ]);
  incomeTotalRow.font = { ...font, bold: true };
  for (let c = 1; c <= 6; c++) incomeTotalRow.getCell(c).fill = fill(C.total);
  const incomeTotalCell = `E${incomeTotalRow.number}`;
  ws.addRow([]);

  // ── 二、支出明細 ──
  sectionRow("▌ 二、支出明細");
  headRow(["#", "費用項目", "計算基礎", "費率", "金額（元）", "備註"]);
  const costStart = ws.rowCount + 1;
  r.costRows.forEach((c, i) => {
    const isManual = !c.isAuto;
    const xr = ws.addRow([
      i + 1,
      c.label,
      c.basisText ?? "",
      c.ratePpm != null ? formatPpm(c.ratePpm) : "",
      // 費率型支出放公式（=ROUND(收入合計×費率,0)），黃色手填列放數值——
      // 收到檔的人改收入或費率，稅費會跟著動；手填的錢本來就不該自己動
      c.isAuto && c.ratePpm != null && (c.code === "INVOICE_TAX" || c.code === "INCOME_TAX")
        ? {
            formula: `ROUND(${incomeTotalCell}*${c.ratePpm / 1_000_000},0)`,
            result: c.amount,
          }
        : c.amount,
      c.kind === "EXTERNAL_SHARE" ? `外部分潤${c.payee ? `：${c.payee}` : ""}` : (c.note ?? ""),
    ]);
    xr.font = font;
    if (isManual) for (let col = 1; col <= 6; col++) xr.getCell(col).fill = fill(C.input);
  });
  const costEnd = ws.rowCount;
  const costTotalRow = ws.addRow([
    "支出合計",
    "",
    "",
    "",
    r.costRows.length
      ? { formula: `SUM(E${costStart}:E${costEnd})`, result: r.totalCost }
      : 0,
  ]);
  costTotalRow.font = { ...font, bold: true };
  for (let c = 1; c <= 6; c++) costTotalRow.getCell(c).fill = fill(C.total);

  const profitRow = ws.addRow([
    "毛利（收入 － 支出）",
    "",
    "",
    "",
    {
      formula: `${incomeTotalCell}-E${costTotalRow.number}`,
      result: r.grossProfit,
    },
  ]);
  profitRow.font = { ...font, size: 11, bold: true, color: { argb: "1F4E79" } };
  for (let c = 1; c <= 6; c++) profitRow.getCell(c).fill = fill(C.profit);
  const profitCell = `E${profitRow.number}`;
  ws.addRow([]);

  // ── 三、分潤計算 ──
  sectionRow("▌ 三、分潤計算（依毛利比例，D 欄比例可調整）");
  headRow(["#", "分潤對象", "計算基礎", "比例", "分潤金額"]);
  const shareStart = ws.rowCount + 1;
  r.shareRows.forEach((s, i) => {
    const rowNo = ws.rowCount + 1;
    const xr = ws.addRow([
      i + 1,
      s.payeeName,
      `毛利 × ${formatPpm(s.sharePpm)}`,
      s.sharePpm / 1_000_000, // 0.4 這種比例值（他的原版 D 欄就是 0.4）
      { formula: `ROUND(${profitCell}*D${rowNo},0)`, result: s.amount },
    ]);
    xr.font = font;
    // 比例欄黃底：這是他會直接改的格子
    xr.getCell(4).fill = fill(C.input);
  });
  const shareEnd = ws.rowCount;
  const shareTotalRow = ws.addRow([
    "合計",
    "",
    "",
    r.shareRows.length
      ? {
          formula: `SUM(D${shareStart}:D${shareEnd})`,
          result: input.sharesPpmTotal / 1_000_000,
        }
      : 0,
    r.shareRows.length
      ? { formula: `SUM(E${shareStart}:E${shareEnd})`, result: r.totalShared }
      : 0,
  ]);
  shareTotalRow.font = { ...font, bold: true };
  for (let c = 1; c <= 6; c++) shareTotalRow.getCell(c).fill = fill(C.total);

  // ── 底部：警示＋例外說明＋資料來源 ──
  ws.addRow([]);
  const notes: string[] = [
    "⚠️ 黃色欄位＝手動填入／可調整；其餘金額由平台計算，合計與分潤為公式（改黃色欄位會自動重算）",
  ];
  for (const w of r.warnings) notes.push(`⚠️ ${w}`);
  // 認列 ≠ 付款、排除認列、退款：逐條列出（他的原版底部就是逐條例外說明）
  for (const o of orders) {
    if (o.refundedAt) {
      notes.push(`訂單 ${o.orderNo}（${o.buyerName}）已退款 NT$${o.refundAmount.toLocaleString("zh-TW")}，未列入本表`);
      continue;
    }
    if (!o.isRecognized) {
      notes.push(`訂單 ${o.orderNo}（${o.buyerName}）暫不認列${o.excludeReason ? `：${o.excludeReason}` : ""}`);
      continue;
    }
    for (const l of o.lines) {
      if (l.recognizedAmount !== l.amount) {
        notes.push(
          `訂單 ${o.orderNo}（${o.buyerName}）付款 NT$${l.amount.toLocaleString("zh-TW")}、本表認列 NT$${l.recognizedAmount.toLocaleString("zh-TW")}${l.recognizeNote ? `：${l.recognizeNote}` : ""}`,
        );
      }
    }
  }
  if (input.sourceNote) notes.push(input.sourceNote);
  if (input.sourceFile) notes.push(`資料來源：1shop 訂單匯出檔 ${input.sourceFile}`);
  notes.push(`本表由 course.huangxi.info 場次收支模組產出（${today}）`);
  for (const n of notes) {
    const row = ws.addRow([n]);
    ws.mergeCells(row.number, 1, row.number, 6);
    row.font = { ...font, size: 9, color: { argb: n.startsWith("⚠️") ? "CC0000" : "888888" } };
  }

  return wb;
}
