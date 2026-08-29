/* PAYUNi 統一金流串接驗證（純離線，不打任何 API、不碰資料庫）。
 *
 * 測試階梯第一關：加解密與驗章的正確性。
 * 基準是官方文件「Node.js 範例」附的測試向量（同一組輸入官方算出的結果）——
 * 過了這關代表金鑰用法、加密格式、雜湊順序全部對，串接錯誤大多在這裡現形。
 * 文件：https://docs.payuni.com.tw/web/#/7/312
 *
 * 跑法：npx tsx scripts/test-payuni.ts */
import {
  payuniEncrypt,
  payuniDecrypt,
  payuniHash,
  PayuniProvider,
} from "../src/lib/payment/payuni";

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

// ── 官方測試向量（docs #/7/312，模擬商店資料）──
const VECTOR = {
  plaintext: "MerID=AAA&MerTradeNO=BBB&Prod=%E5%95%86%E5%93%81%E8%AA%AA%E6%98%8E",
  key: "12345678901234567890123456789012",
  iv: "1234567890123456",
  encrypted:
    "47396636346f66735853533167396942344f587a3775696b34732b596e70452b675270564f73536b7753446c6a4d77526d4e374256514173672b6c78616d4533504d475152642b362f4530626f446e4f6356533969756c743a3a3a4b5961342f4635456965743069385a784b6277704a413d3d",
  sha256: "E97180D78C8378D64A188D292938B9D2717034F292B626019B01DF160AEFC0B7",
};

console.log("\n官方測試向量（加密結果必須與文件位元相同）");
{
  const enc = payuniEncrypt(VECTOR.plaintext, VECTOR.key, VECTOR.iv);
  check("AES-256-GCM 加密結果與官方一致", enc === VECTOR.encrypted);
  check("SHA256 HashInfo 與官方一致", payuniHash(enc, VECTOR.key, VECTOR.iv) === VECTOR.sha256);
  check(
    "解密官方密文還原出官方明文",
    payuniDecrypt(VECTOR.encrypted, VECTOR.key, VECTOR.iv) === VECTOR.plaintext,
  );
}

console.log("\n加解密往返與竄改偵測");
{
  const key = "abcdefghijklmnopqrstuvwxyz123456";
  const iv = "abcdef1234567890";
  const original = "MerID=S123&MerTradeNo=OD_test-1&TradeAmt=4500&Prod=%E8%AA%B2%E7%A8%8B";
  const enc = payuniEncrypt(original, key, iv);
  check("加密→解密還原", payuniDecrypt(enc, key, iv) === original);

  // GCM 完整性：動密文任一位元，解密必須 throw 而不是回傳錯誤明文
  const tampered = enc.slice(0, 10) + (enc[10] === "a" ? "b" : "a") + enc.slice(11);
  let threw = false;
  try {
    payuniDecrypt(tampered, key, iv);
  } catch {
    threw = true;
  }
  check("竄改密文 → GCM 驗證 throw（不會解出錯誤內容）", threw);

  check("錯誤金鑰解不開", (() => {
    try {
      payuniDecrypt(enc, "wrongwrongwrongwrongwrongwrong12", iv);
      return false;
    } catch {
      return true;
    }
  })());
}

const provider = new PayuniProvider({
  merchantId: "S01TEST001",
  hashKey: "12345678901234567890123456789012",
  hashIV: "1234567890123456",
  apiUrl: "https://sandbox-api.payuni.com.tw/api/upp",
});

console.log("\ncreatePayment（UPP 建單欄位）");
{
  const { action, fields } = provider.createPayment({
    orderNo: "ODtest1234567890AB",
    amount: 4500,
    itemName: "量子思維2.0 台北場",
    tradeDesc: "course-order",
    returnUrl: "https://course.huangxi.info/api/payment/payuni/notify",
    resultUrl: "https://course.huangxi.info/api/payment/payuni/return",
    clientBackUrl: "https://course.huangxi.info/orders/ODtest1234567890AB",
  });
  check("action 指向 sandbox UPP", action === "https://sandbox-api.payuni.com.tw/api/upp");
  check("外層四欄齊備", !!(fields.MerID && fields.Version && fields.EncryptInfo && fields.HashInfo));
  check("Version 固定 2.0", fields.Version === "2.0");
  check(
    "HashInfo 可用金鑰重算驗證",
    payuniHash(fields.EncryptInfo, "12345678901234567890123456789012", "1234567890123456") ===
      fields.HashInfo,
  );

  const inner = Object.fromEntries(
    new URLSearchParams(
      payuniDecrypt(fields.EncryptInfo, "12345678901234567890123456789012", "1234567890123456"),
    ),
  );
  check("EncryptInfo 內層 MerID 與外層一致", inner.MerID === fields.MerID);
  check("MerTradeNo 帶入訂單號", inner.MerTradeNo === "ODtest1234567890AB");
  check("TradeAmt 正確", inner.TradeAmt === "4500");
  check("NotifyURL＝背景通知（介面的 returnUrl）", inner.NotifyURL?.endsWith("/payuni/notify") === true);
  check("ReturnURL＝前景導回（介面的 resultUrl）", inner.ReturnURL?.endsWith("/payuni/return") === true);
  check("ProdDesc 帶入中文商品名", inner.ProdDesc === "量子思維2.0 台北場");
  check("Timestamp 為秒級整數", /^\d{10}$/.test(inner.Timestamp ?? ""));
}

console.log("\nverifyCallback（Notify 三態判定）");
{
  // 模擬 PAYUNi 回呼：用同一組金鑰把內層欄位加密成一包
  const makeNotify = (inner: Record<string, string>) => {
    const qs = new URLSearchParams(inner).toString();
    const enc = payuniEncrypt(qs, "12345678901234567890123456789012", "1234567890123456");
    return {
      MerID: "S01TEST001",
      Version: "2.0",
      Status: inner.Status,
      EncryptInfo: enc,
      HashInfo: payuniHash(enc, "12345678901234567890123456789012", "1234567890123456"),
    };
  };
  const base = {
    MerID: "S01TEST001",
    MerTradeNo: "ODtest1234567890AB",
    TradeNo: "1700000000000000001",
    TradeAmt: "4500",
    PaymentType: "1",
  };

  const paid = provider.verifyCallback(makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "1" }));
  check("已付款 → valid + paid", paid.valid && paid.success && paid.tradeState === "paid");
  check("金額/商店/訂單號解密正確", paid.amount === 4500 && paid.merchantId === "S01TEST001" && paid.orderNo === "ODtest1234567890AB");
  check("PaymentType 轉可讀標籤", paid.paymentType === "Credit");

  const atmPending = provider.verifyCallback(
    makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "0", PaymentType: "2" }),
  );
  check("ATM 取號成功 → pending 不是 failed（等付款，不能標 FAILED）",
    atmPending.valid && !atmPending.success && atmPending.tradeState === "pending");

  const unknown = provider.verifyCallback(makeNotify({ ...base, Status: "UNKNOWN", TradeStatus: "0" }));
  check("銀行逾時 UNKNOWN → pending", unknown.tradeState === "pending");

  const failed = provider.verifyCallback(makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "2" }));
  check("付款失敗 → failed", failed.valid && failed.tradeState === "failed");

  const cancelled = provider.verifyCallback(makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "3" }));
  check("付款取消 → failed", cancelled.tradeState === "failed");

  // 攻擊面：偽造 HashInfo、竄改 EncryptInfo、缺欄位
  const forged = makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "1" });
  forged.HashInfo = "0".repeat(64);
  check("偽造 HashInfo → 拒收", !provider.verifyCallback(forged).valid);

  const tampered = makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "1" });
  tampered.EncryptInfo = tampered.EncryptInfo.slice(0, -2) + "ff";
  check("竄改 EncryptInfo → 拒收（Hash 對不上）", !provider.verifyCallback(tampered).valid);

  // 竄改密文但重算 Hash（拿不到 key 做不到，這裡模擬「Hash 對但 GCM tag 錯」的防線）
  const evil = makeNotify({ ...base, Status: "SUCCESS", TradeStatus: "1" });
  const bad = evil.EncryptInfo.slice(0, 10) + (evil.EncryptInfo[10] === "a" ? "b" : "a") + evil.EncryptInfo.slice(11);
  evil.EncryptInfo = bad;
  evil.HashInfo = payuniHash(bad, "12345678901234567890123456789012", "1234567890123456");
  check("Hash 重算但密文壞 → GCM 擋下拒收", !provider.verifyCallback(evil).valid);

  check("空 payload → 拒收", !provider.verifyCallback({}).valid);
}

console.log(`\n${fail === 0 ? "✓ 全數通過" : "✗ 有失敗項目"}：${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
