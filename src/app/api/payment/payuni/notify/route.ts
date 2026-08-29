import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider, type PayuniVerifyResult } from "@/lib/payment/payuni";
import {
  settlePaidOrder,
  settleFailedOrder,
  issueInvoiceForOrder,
} from "@/lib/payment/settle";
import { getInvoicePolicy } from "@/lib/invoice/policy";

// PAYUNi AES 需要 node:crypto，禁用 edge runtime
export const runtime = "nodejs";

/**
 * PAYUNi server-to-server 背景通知（NotifyURL）。訂單付款狀態的唯一真實來源。
 *
 * 與 ECPay route 分開的原因：PAYUNi 是三態——
 *   paid（TradeStatus=1）／pending（ATM/超商取號成功、銀行逾時 UNKNOWN）／failed。
 * pending 塞不進 success/fail 二分：取號成功標成 FAILED 會把「等 ATM 轉帳中」
 * 的訂單搞死，付款完成的第二次 Notify 就開不了通。
 *
 * 結算與開票邏輯在 src/lib/payment/settle.ts——後台「金流確認/補開通」共用，
 * 兩邊行為保證一致。回應：PAYUNi 收到 HTTP 200 即停止重送。
 */
export async function POST(req: NextRequest) {
  // 公開端點會被掃描器亂打：非 form body 的請求 formData() 會 throw，
  // 要回 400 而不是 500（500 會讓監控以為程式壞了）
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });

  const provider = getPaymentProvider();
  // 走錯 provider 的通知一律拒收（例：PAYMENT_PROVIDER 還是 ecpay 卻打到這裡）
  if (!(provider instanceof PayuniProvider)) {
    console.error("[payuni notify] PAYMENT_PROVIDER 不是 payuni，拒收通知");
    return new Response("provider mismatch", { status: 400 });
  }

  const result: PayuniVerifyResult = provider.verifyCallback(payload);

  // 防線 1：驗章／解密失敗直接拒絕
  if (!result.valid) {
    console.error("[payuni notify] HashInfo 驗章失敗");
    return new Response("hash mismatch", { status: 400 });
  }

  // pending（取號成功／授權結果未定）：記錄但不動訂單狀態，等下一次通知
  if (result.tradeState === "pending") {
    console.log("[payuni notify] pending", {
      orderNo: result.orderNo,
      paymentType: result.paymentType,
    });
    return new Response("OK");
  }

  try {
    if (result.tradeState === "paid") {
      // 防線 2/3：冪等與金額比對在 settlePaidOrder 內；商店代號比對在這
      if (result.merchantId !== process.env.PAYUNI_MER_ID) {
        console.error("[payuni notify] 商店代號不符", { orderNo: result.orderNo });
        return new Response("OK"); // 記錄異常但回 200 停止重送
      }
      const settled = await settlePaidOrder({
        orderNo: result.orderNo,
        amount: result.amount,
        tradeNo: result.tradeNo,
        paymentType: result.paymentType,
        raw: result.raw,
      });
      if (!settled.ok) {
        console.error("[payuni notify] 結算拒絕", {
          orderNo: result.orderNo,
          reason: settled.reason,
        });
        return new Response("OK");
      }
      // 發票在 transaction 之外；await 完才回 200——serverless 回應後就凍結。
      // 開立時機依政策：只有「完款就開立」才在這裡自動開，
      // 手動／按狀態的模式由後台操作觸發
      if (!settled.already && (await getInvoicePolicy()).mode === "AUTO_PAID") {
        await issueInvoiceForOrder(result.orderNo);
      }
    } else {
      await settleFailedOrder(result.orderNo, result.raw);
    }
  } catch (error) {
    console.error("[payuni notify] error:", error);
    return new Response("server error", { status: 500 });
  }

  return new Response("OK");
}
