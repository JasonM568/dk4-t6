import type { PaymentProvider } from "./types";
import { EcpayProvider } from "./ecpay";

let cached: PaymentProvider | null = null;

/** 依環境變數回傳目前啟用的金流 provider（之後可加 newebpay 分支）*/
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  switch (process.env.PAYMENT_PROVIDER) {
    // case "newebpay":
    //   cached = new NewebPayProvider({ ... });
    //   break;
    case "ecpay":
    default:
      cached = new EcpayProvider({
        merchantId: process.env.ECPAY_MERCHANT_ID ?? "2000132",
        hashKey: process.env.ECPAY_HASH_KEY ?? "5294y06JbISpM5x9",
        hashIV: process.env.ECPAY_HASH_IV ?? "v77hoKGq4kWxNNIS",
        apiUrl:
          process.env.ECPAY_API_URL ??
          "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
      });
  }
  return cached;
}

export * from "./types";
