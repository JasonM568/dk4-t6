/* 收支匯入端到端驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 合成訂單檔的表頭取自真實 1shop 匯出（order_2026_08_28_14_16_09.xlsx 55 欄的子集），
 * 「金流」值域也用真實值（信用卡/信用卡線上付款/信用卡分3期/ATM匯款轉帳/
 * 單筆滿3000可信用卡分3期）。
 * 驗的是錢的四條命門：多明細列不漏、同行者不重複計、重匯冪等、
 * 人工調整不被覆蓋、退款保留不硬刪。
 * 跑法：npx tsx --conditions=react-server scripts/test-session-finance-db.ts */
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";
import { importOrders } from "../src/lib/session-import";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

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

const KEYWORD = "fin測試場次";

// 真實 1shop 表頭的子集（欄名一字不差）
const HEADER = [
  "訂單編號", "建立日期", "訂單狀態", "顧客", "產品", "產品數量",
  "單價", "小計", "金流", "金流狀態", "顧客電話", "顧客信箱",
];
type Row = {
  orderNo: string; name: string; product?: string; qty?: number;
  unit?: number; amount?: number; pay?: string; payStatus?: string; status?: string;
};
const mk = (r: Row) => [
  r.orderNo, "2026-08-20 10:00:00", r.status ?? "已完成", r.name,
  r.product ?? `${KEYWORD} 新生方案`, r.qty ?? 1,
  r.unit ?? 2800, r.amount ?? (r.unit ?? 2800) * (r.qty ?? 1),
  r.pay ?? "信用卡", r.payStatus ?? "已付款",
  "0912345678", "fin-test@example.com",
];
async function xlsx(rowsIn: Row[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("訂單");
  ws.addRow(HEADER);
  for (const r of rowsIn) ws.addRow(mk(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

async function totals(sessionId: string) {
  const orders = await prisma.sessionOrder.findMany({
    where: { sessionId },
    include: { lines: true },
  });
  const income = orders
    .filter((o) => o.isRecognized && !o.refundedAt)
    .reduce((n, o) => n + o.lines.reduce((m, l) => m + l.recognizedAmount, 0), 0);
  return { orders, income };
}

async function cleanup() {
  await prisma.courseSession.deleteMany({ where: { title: { startsWith: KEYWORD } } });
}

async function main() {
  await cleanup();
  const session = await prisma.courseSession.create({
    data: { title: `${KEYWORD} A`, keywords: [KEYWORD] },
  });

  try {
    // ── 1. 基本匯入：多明細列訂單不漏錢 ──
    console.log("\n多明細列與付款方式");
    const file1 = await xlsx([
      // 莊秀玲式訂單：同一張訂單「複訓×2＋新生×1」分兩列匯出
      { orderNo: "F001", name: "測試甲", product: `${KEYWORD} 複訓方案`, qty: 2, unit: 1500, pay: "信用卡" },
      { orderNo: "F001", name: "測試甲", product: `${KEYWORD} 新生方案`, qty: 1, unit: 2800, pay: "信用卡" },
      { orderNo: "F002", name: "測試乙", unit: 2800, pay: "信用卡分3期" },
      { orderNo: "F003", name: "測試丙", unit: 2800, pay: "ATM匯款轉帳" },
      { orderNo: "F004", name: "測試丁", unit: 2800, pay: "單筆滿3000可信用卡分3期" },
      { orderNo: "F005", name: "測試戊", unit: 2800, pay: "信用卡線上付款" },
    ]);
    const r1 = await importOrders(file1);
    check("金額階段寫入 5 張訂單", r1.finance.ordersUpserted === 5, `實際 ${r1.finance.ordersUpserted}`);
    check("明細 6 列（F001 佔兩列）", r1.finance.linesWritten === 6, `實際 ${r1.finance.linesWritten}`);

    const t1 = await totals(session.id);
    // 1500×2 + 2800×1 + 2800×4 = 3000+2800+11200 = 17000
    check("收入 17,000（多明細列的錢一列不少）", t1.income === 17_000, `實際 ${t1.income}`);
    const f001 = t1.orders.find((o) => o.orderNo === "F001");
    check("F001 有 2 條明細列", f001?.lines.length === 2);
    const methods = new Map(t1.orders.map((o) => [o.orderNo, o.paymentMethod]));
    check("F002 → CREDIT_INSTALLMENT（3期）", methods.get("F002") === "CREDIT_INSTALLMENT");
    check("F004 → CREDIT_INSTALLMENT（另一種寫法）", methods.get("F004") === "CREDIT_INSTALLMENT");
    check("F005 → CREDIT_ONE（信用卡線上付款）", methods.get("F005") === "CREDIT_ONE");
    check("F003 → ATM", methods.get("F003") === "ATM");

    // 名單端也照常工作（同一次匯入）
    const signups = await prisma.sessionSignup.count({ where: { sessionId: session.id } });
    check("名單端照常建列（金額階段不干擾）", signups > 0, `名單 ${signups} 列`);

    // ── 2. 冪等：重匯不變 ──
    console.log("\n重匯冪等");
    await importOrders(file1);
    const t2 = await totals(session.id);
    check("重匯後收入不變", t2.income === 17_000, `實際 ${t2.income}`);
    check("重匯後訂單數不變", t2.orders.length === 5, `實際 ${t2.orders.length}`);

    // ── 3. 人工調整不被覆蓋 ──
    console.log("\nmanualOverride 保護");
    const target = t2.orders.find((o) => o.orderNo === "F001")!;
    await prisma.sessionOrder.update({
      where: { id: target.id },
      data: { manualOverride: true },
    });
    await prisma.sessionOrderLine.updateMany({
      where: { orderId: target.id, unitPrice: 2800 },
      data: { recognizedAmount: 1000, recognizeNote: "組合方案：本場只認列 1000" },
    });
    const r3 = await importOrders(file1);
    check(
      "重匯報告列出未覆蓋的訂單",
      r3.finance.skippedOverride.some((x) => x.orderNo === "F001"),
    );
    const t3 = await totals(session.id);
    // 17000 - (2800-1000) = 15200
    check("人工認列調整保住（收入 15,200）", t3.income === 15_200, `實際 ${t3.income}`);

    // ── 4. 退款：金額列保留、名單列刪除 ──
    console.log("\n退款保留");
    const file2 = await xlsx([
      { orderNo: "F002", name: "測試乙", unit: 2800, pay: "信用卡分3期", payStatus: "已退款" },
    ]);
    const r4 = await importOrders(file2);
    check(
      "退款進報告",
      r4.finance.refundMarked.some((x) => x.orderNo === "F002" && x.amount === 2_800),
      JSON.stringify(r4.finance.refundMarked),
    );
    const f002 = await prisma.sessionOrder.findFirst({ where: { orderNo: "F002" } });
    check("金額列保留且標退款", !!f002?.refundedAt && f002.refundAmount === 2_800);
    check("退款訂單不認列", f002?.isRecognized === false);
    const t4 = await totals(session.id);
    check("收入扣除退款（12,400）", t4.income === 12_400, `實際 ${t4.income}`);
    const f002signup = await prisma.sessionSignup.count({ where: { orderNo: "F002" } });
    check("名單列已刪（人不來了，原行為不變）", f002signup === 0);

    // ── 5. financeOnly 模式：不碰名單 ──
    console.log("\nfinanceOnly 模式");
    const before = await prisma.sessionSignup.count({ where: { sessionId: session.id } });
    const file3 = await xlsx([
      { orderNo: "F010", name: "補金額者", unit: 5000, pay: "信用卡" },
    ]);
    const r5 = await importOrders(file3, { mode: "financeOnly" });
    check("金額有寫", r5.finance.ordersUpserted === 1);
    const after = await prisma.sessionSignup.count({ where: { sessionId: session.id } });
    check("名單完全沒動", after === before, `前 ${before} 後 ${after}`);

    // ── 6. LOCKED 場次凍結 ──
    console.log("\nLOCKED 凍結");
    await prisma.sessionFinance.create({
      data: { sessionId: session.id, status: "LOCKED", totalIncome: 999 },
    });
    const file4 = await xlsx([
      { orderNo: "F020", name: "結算後才來", unit: 8000, pay: "信用卡" },
    ]);
    const r6 = await importOrders(file4, { mode: "financeOnly" });
    check(
      "已結算場次的訂單被擋下並列入報告",
      r6.finance.ordersUpserted === 0 &&
        r6.finance.skippedLocked.some((x) => x.orderNo === "F020"),
      JSON.stringify(r6.finance.skippedLocked),
    );
  } finally {
    await cleanup();
  }

  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
