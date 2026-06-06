/**
 * ECPay CheckMacValue 驗證測試
 * 執行：npx tsx scripts/test-ecpay.ts
 *
 * 1) round-trip：createPayment 產生的欄位，verifyCallback 應判定 valid=true
 * 2) 固定輸入輸出：印出一組固定參數的 CheckMacValue，可拿去和 ECPay 官方
 *    「CheckMacValue 驗證工具」比對，確認演算法完全一致。
 */
import { EcpayProvider, ecpayCheckMacValue } from "../src/lib/payment/ecpay";

const config = {
  merchantId: "2000132",
  hashKey: "5294y06JbISpM5x9",
  hashIV: "v77hoKGq4kWxNNIS",
  apiUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
};

const provider = new EcpayProvider(config);

// ── (1a) createPayment 自簽自驗（同一欄位集合應 valid=true）──────
const created = provider.createPayment({
  orderNo: "TEST20260606001",
  amount: 2400,
  itemName: "Next.js 全端開發實戰",
  tradeDesc: "course-platform order",
  returnUrl: "https://example.com/api/payment/ecpay/notify",
  resultUrl: "https://example.com/api/payment/ecpay/return",
  clientBackUrl: "https://example.com/my-courses",
});
const selfVerify = provider.verifyCallback(created.fields);
console.log("=== createPayment 自驗 ===");
console.log("CheckMacValue:", created.fields.CheckMacValue);
console.log("verify valid :", selfVerify.valid, "(期望 true)");

// ── (1b) 模擬 ECPay callback：先組 callback 欄位 → 簽章 → 驗證 ──
const callback: Record<string, string> = {
  MerchantID: config.merchantId,
  MerchantTradeNo: "TEST20260606001",
  RtnCode: "1",
  RtnMsg: "交易成功",
  TradeNo: "2602061200000001",
  TradeAmt: "2400",
  PaymentDate: "2026/06/06 12:05:00",
  PaymentType: "Credit_CreditCard",
  PaymentTypeChargeFee: "0",
  TradeDate: "2026/06/06 12:00:00",
  SimulatePaid: "0",
};
callback.CheckMacValue = ecpayCheckMacValue(
  callback,
  config.hashKey,
  config.hashIV,
);
const roundTrip = provider.verifyCallback(callback);
console.log("\n=== 模擬 ECPay callback 驗章 ===");
console.log("verify valid :", roundTrip.valid, "(期望 true)");
console.log("success      :", roundTrip.success, "(期望 true)");
console.log("orderNo      :", roundTrip.orderNo);

// ── (2) 固定輸入輸出（可與官方工具比對）────────────────────────
const fixed: Record<string, string> = {
  MerchantID: "2000132",
  MerchantTradeNo: "ecpay20260101",
  MerchantTradeDate: "2026/01/01 12:00:00",
  PaymentType: "aio",
  TotalAmount: "1000",
  TradeDesc: "test",
  ItemName: "item",
  ReturnURL: "https://example.com/return",
  ChoosePayment: "ALL",
  EncryptType: "1",
};
console.log("\n=== fixed vector ===");
console.log(JSON.stringify(fixed, null, 2));
console.log(
  "CheckMacValue:",
  ecpayCheckMacValue(fixed, config.hashKey, config.hashIV),
);

if (!selfVerify.valid || !roundTrip.valid || !roundTrip.success) {
  console.error("\n❌ 驗章失敗，演算法有誤");
  process.exit(1);
}
console.log("\n✅ 全部通過");
