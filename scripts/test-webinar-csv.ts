/* 講座名單 CSV 的組裝驗證（純離線，不碰 DB）。
 *
 * 這份檔案會離開系統（下載到電腦、轉寄出去），所以三件事不能錯：
 *   1. 逗號／引號／換行要跳脫——姓名裡一個逗號就會把整份表格錯位，而且開起來「看起來正常」
 *   2. 09 開頭的手機不能被試算表吃成數字（變成 9 開頭）
 *   3. 被蜜罐擋下的那幾筆必須明顯標示——他們看到「已寄出」但其實沒收到信
 *
 * 跑法：npx tsx scripts/test-webinar-csv.ts */
import { buildCsv, csvCell } from "../src/lib/csv-export";

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

console.log("\n跳脫：名單裡的逗號／引號／換行不能把表格弄錯位");
{
  check("逗號被引號包住", csvCell("陳大明, 業務部") === '"陳大明, 業務部"');
  check("引號變成兩個雙引號", csvCell('他說"好"') === '"他說""好"""');
  check("換行原樣保留在引號內", csvCell("第一行\n第二行") === '"第一行\n第二行"');
  check("null → 空字串", csvCell(null) === '""');
  check("undefined → 空字串", csvCell(undefined) === '""');
}

console.log("\n公式注入：= + - @ 開頭的值不能被試算表當公式執行");
{
  check("=cmd 被前綴單引號", csvCell("=1+1") === `"'=1+1"`);
  check("+886 被前綴單引號", csvCell("+886912345678") === `"'+886912345678"`);
  check("@ 開頭被前綴單引號", csvCell("@name") === `"'@name"`);
  check("-1 被前綴單引號", csvCell("-1") === `"'-1"`);
}

console.log("\nExcel 開中文不亂碼：檔案要有 BOM，換行是 CRLF");
{
  const csv = buildCsv([["姓名", "Email"], ["陳大明", "a@b.com"]]);
  check("開頭是 UTF-8 BOM", csv.startsWith("﻿"));
  check("列與列之間是 CRLF", csv.includes('"Email"\r\n"陳大明"'));
  check("結尾也有換行", csv.endsWith("\r\n"));
}

console.log("\n手機保留開頭的 0（route 會前綴 '，否則 0912 會變成 912）");
{
  // route 的寫法：r.phone ? `'${formatMobile(r.phone)}` : ""
  const cell = csvCell("'0912-345-678");
  check("09 開頭前面帶單引號", cell === `"'0912-345-678"`);
  check("沒填手機 → 空白而不是 undefined", csvCell("") === '""');
}

console.log("\n被擋下的那幾筆：另開一欄標記，不混進正常名單也不整批消失");
{
  const HEAD = ["姓名", "Email", "手機", "索取時間", "寄送狀態", "失敗原因", "寄送次數", "簡訊已通知", "被擋下"];
  const 正常 = ["陳大明", "a@b.com", "'0912-345-678", "9/21 10:00", "DELIVERED", "", 1, "", ""];
  const 被擋 = ["李小華", "c@d.com", "'0922-111-222", "9/21 10:05", "", "", "", "", "⚠️ 被擋下（HONEYPOT）未補寄"];
  const csv = buildCsv([HEAD, 正常, 被擋]);
  const rows = csv.replace(/^﻿/, "").trim().split("\r\n");

  check("欄數一致（9 欄）", HEAD.length === 9 && 正常.length === 9 && 被擋.length === 9);
  check("「被擋下」是最後一欄", HEAD[8] === "被擋下");
  check("正常那筆的被擋下欄是空的", rows[1].endsWith('""'));
  check("被擋那筆看得到警告字樣", rows[2].includes("被擋下（HONEYPOT）未補寄"));
  check("被擋那筆沒有寄送狀態（本來就沒寄出去）", 被擋[4] === "");
  check("被擋那筆仍保留 email（要拿來補寄）", 被擋[1] === "c@d.com");
  check("三列（表頭＋2 筆）", rows.length === 3);
}

console.log("\n整份表格不會因為一個逗號而錯位");
{
  const csv = buildCsv([
    ["姓名", "Email", "備註"],
    ["陳,大明", "a@b.com", '他說"要發票"'],
    ["李小華", "c@d.com", "多行\n備註"],
  ]);
  // 每一列的欄位分隔數：跳脫正確的話，逗號都在引號裡
  const body = csv.replace(/^﻿/, "");
  check("含逗號的姓名整個被引號包住", body.includes('"陳,大明"'));
  check("含引號的備註正確倍增", body.includes('"他說""要發票"""'));
  check("含換行的備註沒有被拆成兩列", body.split('"李小華"').length === 2);
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
