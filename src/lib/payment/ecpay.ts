import crypto from "node:crypto";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  VerifyResult,
} from "./types";

// ── ECPay CheckMacValue 簽章（依官方 Node SDK 演算法）──────────────
// 步驟：排序 → 前後加 HashKey/HashIV → encodeURIComponent → .NET 風格還原 → 轉小寫 → SHA256 → 轉大寫
function dotNetUrlEncode(str: string): string {
  const map: Record<string, string> = {
    "%2D": "-",
    "%5F": "_",
    "%2E": ".",
    "%21": "!",
    "%2A": "*",
    "%28": "(",
    "%29": ")",
    "%20": "+",
  };
  let out = str;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

export function ecpayCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

  const step1 = keys.map((k) => `${k}=${params[k]}`).join("&");
  const step2 = `HashKey=${hashKey}&${step1}&HashIV=${hashIV}`;
  const step3 = dotNetUrlEncode(encodeURIComponent(step2)).toLowerCase();
  return crypto.createHash("sha256").update(step3).digest("hex").toUpperCase();
}

function formatTradeDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class EcpayProvider implements PaymentProvider {
  readonly name = "ecpay";

  constructor(
    private readonly config: {
      merchantId: string;
      hashKey: string;
      hashIV: string;
      apiUrl: string;
    },
  ) {}

  createPayment(input: CreatePaymentInput): CreatePaymentResult {
    const fields: Record<string, string> = {
      MerchantID: this.config.merchantId,
      MerchantTradeNo: input.orderNo,
      MerchantTradeDate: formatTradeDate(new Date()),
      PaymentType: "aio",
      TotalAmount: String(input.amount),
      TradeDesc: input.tradeDesc.slice(0, 200),
      ItemName: input.itemName.slice(0, 400),
      ReturnURL: input.returnUrl,
      OrderResultURL: input.resultUrl,
      ClientBackURL: input.clientBackUrl,
      ChoosePayment: "ALL",
      EncryptType: "1",
    };
    fields.CheckMacValue = ecpayCheckMacValue(
      fields,
      this.config.hashKey,
      this.config.hashIV,
    );
    return { action: this.config.apiUrl, fields };
  }

  verifyCallback(payload: Record<string, string>): VerifyResult {
    const expected = ecpayCheckMacValue(
      payload,
      this.config.hashKey,
      this.config.hashIV,
    );
    const valid =
      typeof payload.CheckMacValue === "string" &&
      expected === payload.CheckMacValue.toUpperCase();

    return {
      valid,
      orderNo: payload.MerchantTradeNo ?? "",
      success: payload.RtnCode === "1",
      tradeNo: payload.TradeNo,
      paymentType: payload.PaymentType,
      raw: payload,
    };
  }
}
