import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider, type PayuniVerifyResult } from "@/lib/payment/payuni";
import {
  settleSessionPaidOrder,
  settleSessionFailedOrder,
  issueInvoiceForSessionOrder,
} from "@/lib/payment/session-settle";
import { getInvoicePolicy } from "@/lib/invoice/policy";

// PAYUNi 場次報名訂單背景通知（NotifyURL）。與課程訂單的 /notify 分開——
// 結算對象是 SessionSignupOrder，付款成功轉入場次名單而非開通課程。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
  if (!(provider instanceof PayuniProvider)) {
    console.error("[payuni session-notify] PAYMENT_PROVIDER 不是 payuni，拒收通知");
    return new Response("provider mismatch", { status: 400 });
  }

  const result: PayuniVerifyResult = provider.verifyCallback(payload);
  if (!result.valid) {
    console.error("[payuni session-notify] HashInfo 驗章失敗");
    return new Response("hash mismatch", { status: 400 });
  }

  // 取號成功（ATM/超商）／授權未定：記錄但不動訂單狀態，等繳款完成的下一次通知
  if (result.tradeState === "pending") {
    console.log("[payuni session-notify] pending", {
      orderNo: result.orderNo,
      paymentType: result.paymentType,
    });
    return new Response("OK");
  }

  try {
    if (result.tradeState === "paid") {
      if (result.merchantId !== process.env.PAYUNI_MER_ID) {
        console.error("[payuni session-notify] 商店代號不符", { orderNo: result.orderNo });
        return new Response("OK");
      }
      const settled = await settleSessionPaidOrder({
        orderNo: result.orderNo,
        amount: result.amount,
        tradeNo: result.tradeNo,
        paymentType: result.paymentType,
        raw: result.raw,
      });
      if (!settled.ok) {
        console.error("[payuni session-notify] 結算拒絕", {
          orderNo: result.orderNo,
          reason: settled.reason,
        });
        return new Response("OK");
      }
      if (!settled.already && (await getInvoicePolicy()).mode === "AUTO_PAID") {
        await issueInvoiceForSessionOrder(result.orderNo);
      }
    } else {
      await settleSessionFailedOrder(result.orderNo, result.raw);
    }
  } catch (error) {
    console.error("[payuni session-notify] error:", error);
    return new Response("server error", { status: 500 });
  }

  return new Response("OK");
}
