import type { PaymentProvider } from "./types";
import { EcpayProvider } from "./ecpay";

let cached: PaymentProvider | null = null;

const isProduction =
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";

// 非 production 的沙箱預設值，方便本機開發
const SANDBOX_DEFAULTS = {
  merchantId: "2000132",
  hashKey: "5294y06JbISpM5x9",
  hashIV: "v77hoKGq4kWxNNIS",
  apiUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
} as const;

/**
 * 取得 ECPay 必要設定。
 * production 時任一必要 env 缺失即 throw（fail-fast），避免誤用沙箱測試金鑰；
 * 非 production 仍可 fallback 到沙箱預設值。
 */
function getEcpayConfig() {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIV = process.env.ECPAY_HASH_IV;
  const apiUrl = process.env.ECPAY_API_URL;

  if (isProduction) {
    const missing: string[] = [];
    if (!merchantId) missing.push("ECPAY_MERCHANT_ID");
    if (!hashKey) missing.push("ECPAY_HASH_KEY");
    if (!hashIV) missing.push("ECPAY_HASH_IV");
    if (!apiUrl) missing.push("ECPAY_API_URL");
    if (missing.length > 0) {
      throw new Error(
        `[payment] production 環境缺少必要的 ECPay 設定：${missing.join(
          ", ",
        )}。請設定正式金流環境變數，禁止使用沙箱預設值。`,
      );
    }
    return {
      merchantId: merchantId!,
      hashKey: hashKey!,
      hashIV: hashIV!,
      apiUrl: apiUrl!,
    };
  }

  return {
    merchantId: merchantId ?? SANDBOX_DEFAULTS.merchantId,
    hashKey: hashKey ?? SANDBOX_DEFAULTS.hashKey,
    hashIV: hashIV ?? SANDBOX_DEFAULTS.hashIV,
    apiUrl: apiUrl ?? SANDBOX_DEFAULTS.apiUrl,
  };
}

/** 依環境變數回傳目前啟用的金流 provider（之後可加 newebpay 分支）*/
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  switch (process.env.PAYMENT_PROVIDER) {
    // case "newebpay":
    //   cached = new NewebPayProvider({ ... });
    //   break;
    case "ecpay":
    default:
      cached = new EcpayProvider(getEcpayConfig());
  }
  return cached;
}

export * from "./types";
