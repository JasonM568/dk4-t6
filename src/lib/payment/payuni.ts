import crypto from "crypto";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  VerifyResult,
} from "./types";

// PAYUNi 統一金流（統一數發）— 整合式支付頁 UPP Ver 2.0
// 文件：https://docs.payuni.com.tw/web/#/7/34（規格快照存 docs/payuni/）
//
// 與 ECPay 的根本差異：參數不是明文＋CheckMacValue，而是整包 query string
// 用 AES-256-GCM 加密成 EncryptInfo，再以 SHA256(key+密文+iv) 做 HashInfo。
// 回呼同格式，驗章 = 重算 HashInfo 比對，解密才拿得到欄位。

/** AES-256-GCM 加密（官方 Node.js 範例的實作，勿改動格式）：
 *  hex( base64(密文) + ":::" + base64(authTag) ) */
export function payuniEncrypt(plaintext: string, key: string, iv: string): string {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, Buffer.from(iv));
  let cipherText = cipher.update(plaintext, "utf8", "base64");
  cipherText += cipher.final("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return Buffer.from(`${cipherText}:::${tag}`).toString("hex").trim();
}

/** AES-256-GCM 解密；密文或 authTag 被竄改會 throw（GCM 的完整性驗證） */
export function payuniDecrypt(encryptStr: string, key: string, iv: string): string {
  const [encryptData, tag] = Buffer.from(encryptStr, "hex").toString().split(":::");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decipherText = decipher.update(encryptData, "base64", "utf8");
  decipherText += decipher.final("utf8");
  return decipherText;
}

/** HashInfo = SHA256(HashKey + EncryptInfo + HashIV)，16 進制大寫 */
export function payuniHash(encryptStr: string, key: string, iv: string): string {
  return crypto
    .createHash("sha256")
    .update(`${key}${encryptStr}${iv}`)
    .digest("hex")
    .toUpperCase();
}

/** 物件 → query string（官方範例用 querystring.stringify；URLSearchParams
 *  對空格編碼為 + 與其一致，鍵序即插入序） */
function toQueryString(data: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) params.set(k, String(v));
  return params.toString();
}

function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) out[k] = v;
  return out;
}

/** PAYUNi 回呼的付款狀態三態。
 *  ATM／超商「取號成功」（TradeStatus=0）不是付款也不是失敗——
 *  收銀台語意的 success/fail 二分裝不下，notify route 要分開處理。 */
export type PayuniTradeState = "paid" | "pending" | "failed";

export type PayuniVerifyResult = VerifyResult & {
  amount: number;
  merchantId: string;
  tradeState: PayuniTradeState;
};

export class PayuniProvider implements PaymentProvider {
  readonly name = "payuni";

  constructor(
    private readonly config: {
      merchantId: string;
      hashKey: string; // 32 字元
      hashIV: string; // 16 字元
      apiUrl: string; // sandbox-api 或 api .payuni.com.tw/api/upp
    },
  ) {}

  createPayment(input: CreatePaymentInput): CreatePaymentResult {
    // 介面語意對應（勿搞反）：
    //   input.returnUrl  = server-to-server 背景通知 → PAYUNi 的 NotifyURL
    //   input.resultUrl  = 使用者付款後瀏覽器導回     → PAYUNi 的 ReturnURL
    //   input.clientBackUrl = 結果頁返回按鈕          → PAYUNi 的 BackURL
    const inner: Record<string, string | number> = {
      MerID: this.config.merchantId,
      MerTradeNo: input.orderNo, // ≤25 字 [A-Za-z0-9_-]；OD…20 字與 WEB-…14 字皆合規
      TradeAmt: input.amount,
      Timestamp: Math.floor(Date.now() / 1000),
      ProdDesc: input.itemName.slice(0, 550),
      NotifyURL: input.returnUrl,
      ReturnURL: input.resultUrl,
      BackURL: input.clientBackUrl,
    };

    const encryptInfo = payuniEncrypt(
      toQueryString(inner),
      this.config.hashKey,
      this.config.hashIV,
    );

    return {
      action: this.config.apiUrl,
      fields: {
        MerID: this.config.merchantId,
        Version: "2.0",
        EncryptInfo: encryptInfo,
        HashInfo: payuniHash(encryptInfo, this.config.hashKey, this.config.hashIV),
      },
    };
  }

  verifyCallback(payload: Record<string, string>): PayuniVerifyResult {
    const encryptInfo = payload.EncryptInfo ?? "";
    const invalid: PayuniVerifyResult = {
      valid: false,
      orderNo: "",
      success: false,
      amount: 0,
      merchantId: "",
      tradeState: "failed",
      raw: payload,
    };

    // 驗章：HashInfo 不符直接拒收，連解密都不做
    const expected = payuniHash(encryptInfo, this.config.hashKey, this.config.hashIV);
    if (!encryptInfo || payload.HashInfo?.toUpperCase() !== expected) return invalid;

    let inner: Record<string, string>;
    try {
      inner = parseQueryString(
        payuniDecrypt(encryptInfo, this.config.hashKey, this.config.hashIV),
      );
    } catch {
      // GCM authTag 驗證失敗 = 密文被動過
      return invalid;
    }

    // TradeStatus: 0=取號成功 1=已付款 2=付款失敗 3=付款取消 8=待確認
    // Status: SUCCESS / UNKNOWN（銀行逾時，之後會補 Notify）/ 錯誤碼
    const paid = inner.Status === "SUCCESS" && inner.TradeStatus === "1";
    const pending =
      inner.Status === "UNKNOWN" ||
      (inner.Status === "SUCCESS" &&
        (inner.TradeStatus === "0" || inner.TradeStatus === "8"));

    return {
      valid: true,
      orderNo: inner.MerTradeNo ?? "",
      success: paid,
      tradeNo: inner.TradeNo,
      paymentType: PAYMENT_TYPE_LABEL[inner.PaymentType ?? ""] ?? inner.PaymentType,
      amount: Number(inner.TradeAmt ?? 0),
      merchantId: inner.MerID ?? "",
      tradeState: paid ? "paid" : pending ? "pending" : "failed",
      raw: { ...payload, ...inner },
    };
  }
}

/** PaymentType 代碼 → 可讀標籤（Payment.paymentType 欄位與後台顯示用） */
const PAYMENT_TYPE_LABEL: Record<string, string> = {
  "1": "Credit",
  "2": "ATM",
  "3": "CVS",
  "5": "CVS_COD",
  "6": "ICashPay",
  "7": "AFTEE",
  "9": "LinePay",
  "10": "TCAT_COD",
  "11": "JKoPay",
};
