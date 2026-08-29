import crypto from "crypto";

// ezPay 電子發票（智付寶加值中心）— 開立發票 API
// 規格：ezPay 官網「電子發票技術串接手冊」（快照存 docs/ezpay/，官方向量見測試）
//
// 與 PAYUNi 的加密完全不同，別搞混：
//   ezPay = AES-256-CBC + PKCS7（blocksize 32，非標準 16！）→ hex 小寫
//   PAYUNi = AES-256-GCM → hex(base64:::tag)
// PostData_ 與 MerchantID_ 的底線後綴是規格的一部分，拿掉就 400。

/** PKCS7 padding，blocksize 32——文件附件一的 addpadding()。
 *  必須以 byte 計長（中文商品名 UTF-8 一字 3 bytes），用字元數算會壞掉。 */
export function ezpayPad(data: Buffer, blockSize = 32): Buffer {
  const pad = blockSize - (data.length % blockSize);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

/** AES-256-CBC 加密（關掉自動 padding，改用上面的 32-byte PKCS7）→ hex 小寫 */
export function ezpayEncrypt(plaintext: string, key: string, iv: string): string {
  const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.from(iv));
  cipher.setAutoPadding(false);
  const padded = ezpayPad(Buffer.from(plaintext, "utf8"));
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("hex");
}

/** 解密（本地測試往返驗證用；正式流程只加密不解密） */
export function ezpayDecrypt(hexStr: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(iv));
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(Buffer.from(hexStr, "hex")), decipher.final()]);
  const pad = out[out.length - 1];
  return out.subarray(0, out.length - pad).toString("utf8");
}

/** 回應檢核碼（附件二）：五欄位 A-Z 排序組 query，前加 HashIV= 後加 &HashKey=，
 *  SHA256 大寫。用來驗證回應真的來自 ezPay，不是被中間人改過。 */
export function ezpayCheckCode(
  fields: {
    MerchantID: string;
    MerchantOrderNo: string;
    InvoiceTransNo: string;
    TotalAmt: string | number;
    RandomNum: string;
  },
  hashKey: string,
  hashIV: string,
): string {
  const sorted = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k as keyof typeof fields]}`)
    .join("&");
  return crypto
    .createHash("sha256")
    .update(`HashIV=${hashIV}&${sorted}&HashKey=${hashKey}`)
    .digest("hex")
    .toUpperCase();
}

export type EzpayConfig = {
  merchantId: string;
  hashKey: string; // 32 字元
  hashIV: string; // 16 字元
  apiUrl: string; // …/API/invoice_issue
};

export type IssueInvoiceInput = {
  orderNo: string; // 商店自訂編號（限英數與 _；連字號會被替換）
  buyerName: string;
  buyerEmail: string;
  itemName: string; // 單一品項
  totalAmt: number; // 含稅總額 = 訂單實付金額
};

export type IssueInvoiceResult =
  | {
      ok: true;
      invoiceNumber: string;
      randomNum: string;
      invoiceTransNo: string;
      raw: Record<string, unknown>;
    }
  | { ok: false; error: string; raw?: Record<string, unknown> };

/** 組開立參數（B2C、即時開立、ezPay 會員載具）。
 *  載具策略：CarrierType=2（ezPay 會員載具，以 buyerEmail 識別）——
 *  結帳頁不用收手機條碼/統編就合規，發票存在買受人的 ezPay 載具可自行歸戶。
 *  之後要開放手機條碼載具或統編，再擴充結帳欄位與這裡的參數。 */
export function buildIssueParams(input: IssueInvoiceInput): Record<string, string> {
  const totalAmt = Math.round(input.totalAmt);
  // B2C 稅內含：銷售額 = 含稅 ÷ 1.05 四捨五入，稅額 = 差額（財政部慣例算法）
  const amt = Math.round(totalAmt / 1.05);
  const taxAmt = totalAmt - amt;
  return {
    RespondType: "JSON",
    Version: "1.4",
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    MerchantOrderNo: input.orderNo.replace(/-/g, "_").slice(0, 20),
    Status: "1", // 即時開立
    Category: "B2C",
    BuyerName: input.buyerName.slice(0, 50),
    BuyerEmail: input.buyerEmail,
    CarrierType: "2", // ezPay 會員載具
    CarrierNum: encodeURIComponent(input.buyerEmail),
    PrintFlag: "N",
    TaxType: "1",
    TaxRate: "5",
    Amt: String(amt),
    TaxAmt: String(taxAmt),
    TotalAmt: String(totalAmt),
    ItemName: input.itemName.slice(0, 30),
    ItemCount: "1",
    ItemUnit: "堂",
    ItemPrice: String(totalAmt), // B2C 為含稅金額
    ItemAmt: String(totalAmt),
    Comment: `訂單 ${input.orderNo}`.slice(0, 71),
  };
}

/** 呼叫 ezPay 開立發票。網路錯誤與 API 錯誤都回 ok:false，由呼叫端記錄；
 *  絕不 throw——開票失敗不能影響付款開通的流程。 */
export async function issueInvoice(
  config: EzpayConfig,
  input: IssueInvoiceInput,
): Promise<IssueInvoiceResult> {
  try {
    const params = buildIssueParams(input);
    const qs = new URLSearchParams(params).toString();
    const postData = ezpayEncrypt(qs, config.hashKey, config.hashIV);

    const res = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        MerchantID_: config.merchantId,
        PostData_: postData,
      }).toString(),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      Status?: string;
      Message?: string;
      Result?: string | Record<string, unknown>;
    };
    if (body.Status !== "SUCCESS") {
      return {
        ok: false,
        error: `${body.Status ?? "UNKNOWN"}: ${body.Message ?? "無訊息"}`,
        raw: body as Record<string, unknown>,
      };
    }

    // Result 可能是 JSON 字串（文件範例）或物件，兩種都接
    const result = (
      typeof body.Result === "string" ? JSON.parse(body.Result) : (body.Result ?? {})
    ) as Record<string, string>;

    // 驗 CheckCode：確認回應真的出自 ezPay（拿得到 HashKey 才算得出來）
    const expected = ezpayCheckCode(
      {
        MerchantID: result.MerchantID,
        MerchantOrderNo: result.MerchantOrderNo,
        InvoiceTransNo: result.InvoiceTransNo,
        TotalAmt: result.TotalAmt,
        RandomNum: result.RandomNum,
      },
      config.hashKey,
      config.hashIV,
    );
    if (result.CheckCode !== expected) {
      return { ok: false, error: "CheckCode 驗證失敗（回應可能被竄改）", raw: body as Record<string, unknown> };
    }

    return {
      ok: true,
      invoiceNumber: result.InvoiceNumber,
      randomNum: result.RandomNum,
      invoiceTransNo: result.InvoiceTransNo,
      raw: body as Record<string, unknown>,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "連線失敗" };
  }
}

/** 從環境變數取得設定；未設定回 null（開票功能靜默停用，不影響金流） */
export function getEzpayConfig(): EzpayConfig | null {
  const merchantId = process.env.EZPAY_INVOICE_MERCHANT_ID;
  const hashKey = process.env.EZPAY_INVOICE_HASH_KEY;
  const hashIV = process.env.EZPAY_INVOICE_HASH_IV;
  const apiUrl = process.env.EZPAY_INVOICE_API_URL;
  if (!merchantId || !hashKey || !hashIV || !apiUrl) return null;
  if (hashKey.length !== 32 || hashIV.length !== 16) {
    console.error("[invoice] EZPAY_INVOICE_HASH_KEY 須 32 字元、HASH_IV 須 16 字元");
    return null;
  }
  return { merchantId, hashKey, hashIV, apiUrl };
}
