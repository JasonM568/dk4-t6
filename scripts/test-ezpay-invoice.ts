/* ezPay 電子發票串接驗證（純離線，不打 API、不碰資料庫）。
 *
 * 基準：官方「電子發票技術串接手冊」附件二的 CheckCode 測試向量、
 * 附件一的加密規格（AES-256-CBC + PKCS7 blocksize **32**，非標準 16）。
 * 跑法：npx tsx scripts/test-ezpay-invoice.ts */
import {
  ezpayPad,
  ezpayEncrypt,
  ezpayDecrypt,
  ezpayCheckCode,
  buildIssueParams,
} from "../src/lib/invoice/ezpay";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}

console.log("\nCheckCode（附件二官方向量，位元級比對）");
{
  const code = ezpayCheckCode(
    {
      MerchantID: "3622183",
      MerchantOrderNo: "201409170000001",
      InvoiceTransNo: "14061313541640927",
      TotalAmt: 500,
      RandomNum: "0142",
    },
    "abcdefg",
    "1234567",
  );
  check(
    "與官方範例一致",
    code === "C4156CA208897278C84D929DE48F4A2BCD1FF3ED4B97D09A14E2E2143E3EFD2E",
    code,
  );
}

console.log("\nPKCS7 padding（blocksize 32——文件的特規，不是標準 16）");
{
  const p1 = ezpayPad(Buffer.from("a".repeat(31)));
  check("31 bytes → 補 1 byte 0x01", p1.length === 32 && p1[31] === 1);
  const p2 = ezpayPad(Buffer.from("a".repeat(32)));
  check("整除時仍補滿一整塊 32 個 0x20", p2.length === 64 && p2[63] === 32);
  // 中文以 byte 計長：中文 5 字 = 15 bytes → 補 17
  const p3 = ezpayPad(Buffer.from("量子思維課"));
  check("中文以 UTF-8 byte 計長", p3.length === 32 && p3[31] === 17);
}

const KEY = "abcdefghijklmnopqrstuvwxyzabcdef"; // 文件附件一的示範金鑰
const IV = "1234567891234567";

console.log("\nAES-256-CBC 加解密");
{
  const qs =
    "RespondType=JSON&Version=1.4&TimeStamp=1444963784&MerchantOrderNo=OD_test&TotalAmt=4500&ItemName=%E9%87%8F%E5%AD%90%E6%80%9D%E7%B6%AD";
  const enc = ezpayEncrypt(qs, KEY, IV);
  check("輸出為 hex 小寫", /^[0-9a-f]+$/.test(enc));
  check("長度為 64 hex 的倍數（32-byte 對齊）", enc.length % 64 === 0);
  check("解密還原", ezpayDecrypt(enc, KEY, IV) === qs);
  check(
    "同輸入同金鑰輸出恆定（CBC 無隨機 IV，可回歸比對）",
    ezpayEncrypt(qs, KEY, IV) === enc,
  );
}

console.log("\n開立參數（B2C 稅內含）");
{
  const p = buildIssueParams({
    orderNo: "ODtest1234567890AB",
    buyerName: "王小明",
    buyerEmail: "test@example.com",
    itemName: "量子思維2.0 台北場",
    totalAmt: 4500,
  });
  check("Version 1.4／即時開立／B2C", p.Version === "1.4" && p.Status === "1" && p.Category === "B2C");
  check("含稅 4500 → 銷售額 4286 + 稅 214", p.Amt === "4286" && p.TaxAmt === "214" && p.TotalAmt === "4500");
  check("銷售額＋稅額＝發票金額", Number(p.Amt) + Number(p.TaxAmt) === Number(p.TotalAmt));
  check("ezPay 會員載具（email 識別，免收手機條碼）", p.CarrierType === "2" && p.CarrierNum === encodeURIComponent("test@example.com"));
  check("載具有值時不印紙本", p.PrintFlag === "N");
  check("ItemPrice=ItemAmt=含稅（B2C 規定）", p.ItemPrice === "4500" && p.ItemAmt === "4500");

  const p2 = buildIssueParams({
    orderNo: "WEB-ABC123",
    buyerName: "測",
    buyerEmail: "a@b.co",
    itemName: "x",
    totalAmt: 100,
  });
  check("訂單號連字號替換為 _（MerchantOrderNo 限英數_）", p2.MerchantOrderNo === "WEB_ABC123");
  check("含稅 100 → 95 + 5", p2.Amt === "95" && p2.TaxAmt === "5");

  const p3 = buildIssueParams({ orderNo: "T1", buyerName: "測", buyerEmail: "a@b.co", itemName: "x", totalAmt: 1 });
  check("1 元 → 銷售額 1 稅 0（金額再小也要平衡）", p3.Amt === "1" && p3.TaxAmt === "0");
}

console.log(`\n${fail === 0 ? "✓ 全數通過" : "✗ 有失敗項目"}：${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
