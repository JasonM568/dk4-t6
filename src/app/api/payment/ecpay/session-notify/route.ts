import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import {
  settleSessionPaidOrder,
  settleSessionFailedOrder,
} from "@/lib/payment/session-settle";

// ECPay 場次報名訂單背景通知（sandbox 測試用；正式金流走 PAYUNi）。
// 與課程訂單的 /notify 分開，結算對象是 SessionSignupOrder。必須回 "1|OK"。
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });

  const provider = getPaymentProvider();
  const result = provider.verifyCallback(payload) as ReturnType<
    typeof provider.verifyCallback
  > & { amount: number; merchantId: string };

  if (!result.valid) {
    return new Response("0|CheckMacValue error");
  }

  const configuredMerchantId =
    process.env.ECPAY_MERCHANT_ID ??
    (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
      ? undefined
      : "2000132");

  try {
    if (result.success) {
      if (result.merchantId !== configuredMerchantId) {
        console.error("[ecpay session-notify] merchant mismatch", {
          orderNo: result.orderNo,
        });
        return new Response("1|OK");
      }
      const settled = await settleSessionPaidOrder({
        orderNo: result.orderNo,
        amount: result.amount,
        tradeNo: result.tradeNo,
        paymentType: result.paymentType,
        raw: payload,
      });
      if (!settled.ok) {
        console.error("[ecpay session-notify] 結算拒絕", {
          orderNo: result.orderNo,
          reason: settled.reason,
        });
      }
    } else {
      await settleSessionFailedOrder(result.orderNo, payload);
    }
  } catch (error) {
    console.error("[ecpay session-notify] error:", error);
    return new Response("0|ServerError");
  }

  return new Response("1|OK");
}
