/* 訂單檔解析驗證：exceljs 換裝後的回歸＋惡意/畸形檔案防線。
 * 只測 parseOrderFile（純解析、不碰 DB）。跑法：npx tsx scripts/test-order-import.ts */
import ExcelJS from "exceljs";
import { parseOrderFile } from "../src/lib/session-import";

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

const HEADER = [
  "訂單編號",
  "建立日期",
  "訂單狀態",
  "顧客",
  "產品",
  "金流狀態",
  "顧客電話",
  "顧客信箱",
  "小計",
];

async function makeXlsx(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("orders");
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

function csvBuf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const parseRows = async (buf: ArrayBuffer) => (await parseOrderFile(buf)).rows;

async function expectThrow(name: string, buf: ArrayBuffer, msgPart: string) {
  try {
    await parseOrderFile(buf);
    check(name, false, "預期拋錯但成功解析");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(name, m.includes(msgPart), `錯誤訊息不符：${m}`);
  }
}

async function main() {
  console.log("— XLSX 正常樣本 —");
  {
    const buf = await makeXlsx([
      HEADER,
      ["A001", "2026-08-03 22:01:16", "已成立", "王小明", "量子課八月場", "已付款", "0912345678", "a@b.com", "3000"],
      ["A002", "2026-08-04 10:00:00", "已取消", "李小華", "量子課八月場", "已退款", "0922333444", "c@d.com", "3000"],
    ]);
    const rows = await parseRows(buf);
    check("解析 2 列", rows.length === 2, `得到 ${rows.length}`);
    check("欄位對應", rows[0]?.orderNo === "A001" && rows[0]?.name === "王小明" && rows[0]?.amount === 3000);
    check("日期補 +08:00", rows[0]?.orderedAt?.toISOString() === "2026-08-03T14:01:16.000Z",
      String(rows[0]?.orderedAt?.toISOString()));
    check("取消列狀態", rows[1]?.orderStatus === "已取消" && rows[1]?.paymentStatus === "已退款");
  }

  console.log("— XLSX 真日期 cell（非字串）—");
  {
    // Excel 存成真日期時 exceljs 回 Date（UTC 牆上時間），應還原成台北時間
    const d = new Date(Date.UTC(2026, 7, 3, 22, 1, 16));
    const buf = await makeXlsx([
      HEADER,
      ["B001", d, "已成立", "陳大文", "量子課八月場", "已付款", "", "", "1500"],
    ]);
    const rows = await parseRows(buf);
    check("Date cell 還原台北時間", rows[0]?.orderedAt?.toISOString() === "2026-08-03T14:01:16.000Z",
      String(rows[0]?.orderedAt?.toISOString()));
  }

  console.log("— CSV —");
  {
    const rows = await parseRows(csvBuf(
      `${HEADER.join(",")}\n` +
      `C001,2026-08-05 09:30:00,已成立,"林,逗號","產品名稱\n含換行",已付款,0933111222,e@f.com,2500\n`,
    ));
    check("CSV 引號欄位（內嵌逗號/換行）", rows.length === 1 && rows[0]?.name === "林,逗號" &&
      rows[0]?.product.includes("含換行"), JSON.stringify(rows[0]));
    check("CSV 金額", rows[0]?.amount === 2500);
  }
  {
    // Big5 編碼 CSV：解碼策略退回 big5
    const big5 = Buffer.from(
      `${HEADER.join(",")}\nD001,2026-08-05 09:30:00,已成立,張三,量子課,已付款,,,100\n`,
      "utf-8",
    );
    const iconv = new TextDecoder("big5"); // 驗證環境支援 big5 即可，資料仍用 utf-8 測正常路徑
    void iconv;
    const rows = await parseRows(csvBuf(big5.toString("utf-8")));
    check("CSV 基本列", rows.length === 1 && rows[0]?.name === "張三");
  }

  console.log("— 惡意/畸形檔案防線 —");
  await expectThrow(
    "舊版 .xls magic bytes 拒收",
    new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer as ArrayBuffer,
    "舊版 .xls",
  );
  await expectThrow(
    "偽裝 zip 但非 xlsx",
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]).buffer as ArrayBuffer,
    "無法解析 XLSX",
  );
  await expectThrow(
    "CSV 超過列數上限",
    csvBuf(`${HEADER.join(",")}\n` + Array.from({ length: 20_001 }, (_, i) => `R${i},,,x,y,z,,,1`).join("\n")),
    "列數過多",
  );
  await expectThrow(
    "CSV 超過欄位上限",
    csvBuf(Array.from({ length: 151 }, (_, i) => `c${i}`).join(",") + "\nx".repeat(3)),
    "欄位數過多",
  );
  {
    // 1shop 原始訂單資料新版有超過 60 欄；只要必要欄位仍在，就必須能讀取。
    const wideHeader = [...HEADER, ...Array.from({ length: 61 }, (_, i) => `延伸欄位${i + 1}`)];
    const wideRow = ["W001", "2026-08-05 09:30:00", "已成立", "寬表測試", "量子課", "已付款", "", "", "100",
      ...Array.from({ length: 61 }, () => "")];
    const rows = await parseRows(csvBuf(`${wideHeader.join(",")}\n${wideRow.join(",")}\n`));
    check("超過 60 欄的 1shop 原始訂單可解析", rows.length === 1 && rows[0]?.orderNo === "W001");
  }
  {
    // 1shop 自訂欄位會一併匯出：同行者可能是獨立欄位，也可能寫在訂單資訊裡。
    const companionHeader = [...HEADER, "同行友人姓名", "訂單資訊"];
    const companionRow = [
      "P001", "2026-08-05 09:30:00", "已成立", "訂購人", "量子課", "已付款", "", "", "200",
      "同行甲", "同行人姓名：同行乙",
    ];
    const rows = await parseRows(csvBuf(`${companionHeader.join(",")}\n${companionRow.join(",")}\n`));
    check(
      "同行者獨立入列（自訂欄位與訂單資訊）",
      rows[0]?.attendees.map((a) => a.name).join("、") === "訂購人、同行甲、同行乙",
      JSON.stringify(rows[0]?.attendees),
    );
  }
  console.log("— 葷素欄位 —");
  {
    // 1shop 自訂欄位「餐點/用餐」→ 值含素判素、非空判葷、空為未標
    const mealHeader = [...HEADER, "餐點"];
    const mk = (no: string, meal: string) =>
      [no, "2026-08-05 09:30:00", "已成立", `顧客${no}`, "量子課", "已付款", "", "", "100", meal];
    const { rows, mealColumnFound } = await parseOrderFile(csvBuf(
      `${mealHeader.join(",")}\n${[mk("M1", "素食"), mk("M2", "葷食"), mk("M3", ""), mk("M4", "全素")]
        .map((r) => r.join(","))
        .join("\n")}\n`,
    ));
    check("偵測到葷素欄", mealColumnFound);
    check(
      "值判讀：素食/葷食/空/全素",
      rows.map((r) => r.meal).join(",") === "VEG,MEAT,,VEG",
      rows.map((r) => String(r.meal)).join(","),
    );
  }
  {
    // 沒有葷素欄：全部未標、mealColumnFound=false
    const { rows, mealColumnFound } = await parseOrderFile(csvBuf(
      `${HEADER.join(",")}\nN1,2026-08-05 09:30:00,已成立,無欄測試,量子課,已付款,,,100\n`,
    ));
    check("無葷素欄 → 未偵測且列為未標", !mealColumnFound && rows[0]?.meal === null);
  }

  {
    // 亂資料（缺必要標頭）→ 友善錯誤而非 crash
    await expectThrow("缺標頭友善錯誤", csvBuf("哈囉,這不是,訂單檔\n1,2,3\n"), "無法辨識檔案格式");
  }
  {
    // 超長 cell 被截斷不爆記憶體
    const long = "x".repeat(100_000);
    const rows = await parseRows(csvBuf(`${HEADER.join(",")}\nE001,,,${long},p,已付款,,,1\n`));
    check("超長欄位截斷", (rows[0]?.name.length ?? 0) <= 2_000, String(rows[0]?.name.length));
  }

  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
