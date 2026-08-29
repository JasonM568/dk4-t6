import type { PaymentProvider } from "./types";
import { EcpayProvider } from "./ecpay";
import { PayuniProvider } from "./payuni";

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

// PAYUNi 沙箱測試金鑰不公開（每個測試商店一組），本機開發也必須自己在 .env 填
const PAYUNI_SANDBOX_API = "https://sandbox-api.payuni.com.tw/api/upp";

/** 取得 PAYUNi 必要設定；規則同 ECPay——production 缺 env 即 fail-fast */
function getPayuniConfig() {
  const merchantId = process.env.PAYUNI_MER_ID;
  const hashKey = process.env.PAYUNI_HASH_KEY;
  const hashIV = process.env.PAYUNI_HASH_IV;
  const apiUrl = process.env.PAYUNI_API_URL ?? (isProduction ? undefined : PAYUNI_SANDBOX_API);

  const missing: string[] = [];
  if (!merchantId) missing.push("PAYUNI_MER_ID");
  if (!hashKey) missing.push("PAYUNI_HASH_KEY");
  if (!hashIV) missing.push("PAYUNI_HASH_IV");
  if (!apiUrl) missing.push("PAYUNI_API_URL");
  if (missing.length > 0) {
    throw new Error(
      `[payment] PAYMENT_PROVIDER=payuni 但缺少必要設定：${missing.join(", ")}。` +
        `請至 PAYUNi 後台「商店串接資訊」取得 Hash Key / Hash IV 後設定環境變數。`,
    );
  }
  if (hashKey!.length !== 32 || hashIV!.length !== 16) {
    throw new Error(
      "[payment] PAYUNI_HASH_KEY 須為 32 字元、PAYUNI_HASH_IV 須為 16 字元（AES-256-GCM 規格），請確認沒有複製到多餘空白",
    );
  }
  // 正式環境擋 sandbox 網址——最容易犯的錯是上線忘了換 API URL，錢會收不到
  if (isProduction && apiUrl!.includes("sandbox")) {
    throw new Error("[payment] production 環境禁止使用 PAYUNi sandbox API URL");
  }
  return { merchantId: merchantId!, hashKey: hashKey!, hashIV: hashIV!, apiUrl: apiUrl! };
}

/** 依環境變數回傳目前啟用的金流 provider */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  switch (process.env.PAYMENT_PROVIDER) {
    case "payuni":
      cached = new PayuniProvider(getPayuniConfig());
      break;
    case "ecpay":
    default:
      cached = new EcpayProvider(getEcpayConfig());
  }
  return cached;
}

export * from "./types";
