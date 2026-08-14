/* 訂單匯入端到端驗證（會寫入資料庫，**只能對本機 localhost 跑**）：
 * 重點是「每天重匯同一份訂單檔」的行為——已在名單的不動、只長新的、同一個人不會變兩筆。
 * 跑法：npx tsx scripts/test-session-import-db.ts
 * 測完會刪掉自己建的測試場次（cascade 連報名一起刪）。 */
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";
import { importOrders } from "../src/lib/session-import";

// 安全鎖：非本機資料庫一律拒跑（鐵則：絕不對正式站跑寫入測試）
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
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

const KEYWORD = "測試場次-匯入驗證";
const HEADER = [
  "訂單編號", "建立日期", "訂單狀態", "顧客", "產品", "金流狀態",
  "顧客電話", "顧客信箱", "小計", "課程用餐葷素", "同行學員的聯絡資料", "數量",
];
type Order = {
  orderNo: string; name: string; phone: string; email: string;
  meal?: string; companions?: string; qty?: number; status?: string; pay?: string;
};
const row = (o: Order) => [
  o.orderNo, "2026-08-03 10:00:00", o.status ?? "等待確認", o.name, `${KEYWORD} 新生方案`,
  o.pay ?? "已付款", o.phone, o.email, "3000", o.meal ?? "", o.companions ?? "", o.qty ?? 1,
];

async function xlsx(orders: Order[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("orders");
  ws.addRow(HEADER);
  for (const o of orders) ws.addRow(row(o));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

async function main() {
  const session = await prisma.courseSession.create({
    data: { title: KEYWORD, keywords: [KEYWORD], isVisible: false },
  });
  const roster = () =>
    prisma.sessionSignup.findMany({
      where: { sessionId: session.id },
      select: { orderNo: true, attendeeKey: true, name: true, phone: true, email: true, meal: true },
      orderBy: [{ name: "asc" }, { attendeeKey: "asc" }],
    });

  try {
    // 管理員先手動補的人：只有姓名，沒手機沒信箱（貴蘭姐通知的複訓生就是這樣進來的）
    await prisma.sessionSignup.create({
      data: { sessionId: session.id, orderNo: "手動-abc", attendeeKey: "buyer", name: "歐洸熏", product: "複訓｜手動" },
    });

    console.log("— 第一次匯入 —");
    const day1 = await importOrders(
      await xlsx([
        { orderNo: "A001", name: "王小明", phone: "0912345678", email: "a@b.com", meal: "素食" },
        // 同一張訂單帶同行者，其中一位就是管理員手動補過的歐洸熏
        { orderNo: "A002", name: "莊秀玲", phone: "0932575308", email: "c@d.com", qty: 2, companions: "歐洸熏/0975085939" },
        // 同名但手機不同 → 視為不同人，兩位都要進名單
        { orderNo: "A003", name: "陳建中", phone: "0911111111", email: "e@f.com" },
        { orderNo: "A004", name: "陳建中", phone: "0922222222", email: "g@h.com" },
      ]),
    );
    const r1 = await roster();
    check("新增 4 筆（王小明、莊秀玲、陳建中×2）", day1.imported === 4, JSON.stringify(day1));
    check(
      "歐洸熏沒有變成兩筆（跨訂單重複擋下）",
      r1.filter((s) => s.name === "歐洸熏").length === 1 && day1.dupSkipped.length === 1,
      JSON.stringify(day1.dupSkipped),
    );
    check(
      "被擋下的那位，手機回填到手動補的那列（原本空的才補）",
      r1.find((s) => s.name === "歐洸熏")?.phone === "0975085939",
      JSON.stringify(r1.find((s) => s.name === "歐洸熏")),
    );
    check("同名不同手機 → 兩位都在", r1.filter((s) => s.name === "陳建中").length === 2);
    check("葷素/Email 有進來", r1.find((s) => s.name === "王小明")?.meal === "VEG" &&
      r1.find((s) => s.name === "王小明")?.email === "a@b.com");

    console.log("— 隔天重匯同一份檔案（多兩張新訂單）—");
    // 管理員在這中間改過名單：把王小明的葷素改成葷、姓名補註記
    await prisma.sessionSignup.updateMany({
      where: { sessionId: session.id, orderNo: "A001" },
      data: { meal: "MEAT", name: "王小明（小明哥）", groupNo: 3 },
    });
    const day2 = await importOrders(
      await xlsx([
        { orderNo: "A001", name: "王小明", phone: "0912345678", email: "a@b.com", meal: "素食" },
        { orderNo: "A002", name: "莊秀玲", phone: "0932575308", email: "c@d.com", qty: 2, companions: "歐洸熏/0975085939" },
        { orderNo: "A003", name: "陳建中", phone: "0911111111", email: "e@f.com" },
        { orderNo: "A004", name: "陳建中", phone: "0922222222", email: "g@h.com" },
        { orderNo: "A005", name: "李小華", phone: "0955555555", email: "i@j.com" },
        // 同一個人自己又下了一張單（不同訂單編號）→ 不該變兩筆
        { orderNo: "A006", name: "李小華", phone: "0955555555", email: "i@j.com" },
      ]),
    );
    const r2 = await roster();
    check("只新增 1 筆（李小華）", day2.imported === 1, JSON.stringify(day2));
    check("李小華只有一筆（同一檔案內的重複也擋）", r2.filter((s) => s.name === "李小華").length === 1);
    const ming = r2.find((s) => s.orderNo === "A001");
    check("既有列完全不被覆蓋（手改的姓名/葷素/組別留著）",
      ming?.name === "王小明（小明哥）" && ming?.meal === "MEAT", JSON.stringify(ming));
    check("總人數 6（含手動補的歐洸熏）", r2.length === 6, JSON.stringify(r2.map((s) => s.name)));

    console.log("— 退款/取消反向移除 —");
    const day3 = await importOrders(
      await xlsx([{ orderNo: "A005", name: "李小華", phone: "0955555555", email: "i@j.com", pay: "已退款" }]),
    );
    check("退款移除 1 筆", day3.canceledRemoved === 1 && (await roster()).length === 5);
  } finally {
    await prisma.courseSession.delete({ where: { id: session.id } });
  }

  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main();
