import { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { settlePaidOrder, settleFailedOrder } from "@/lib/payment/settle";

// ECPay 簽章需要 node:crypto，禁用 edge runtime
export const runtime = "nodejs";

/**
 * ECPay server-to-server 背景通知（ReturnURL）。
 * 這是訂單付款狀態的「唯一真實來源」。必須回傳純文字 "1|OK"。
 *
 * 結算／開通／消費累計與冪等判斷全走 src/lib/payment/settle.ts——後台「金流確認」
 * 與 PAYUNi notify 共用同一份。ECPay route 曾自帶一份 inline 結算，冪等只認 PAID，
 * 沒涵蓋 CONFIRMED/COMPLETED/REFUNDED/CANCELLED：管理員把單標成已確認後，ECPay
 * 重送通知就會二次累加 totalSpent、灌水升等，甚至把已取消/已退款的單翻回 PAID。
 * 改為委派 settle.ts 後兩邊行為一致，這類重送不再重複結算。
 */
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

  // 防線 1：驗章失敗直接拒絕
  if (!result.valid) {
    return new Response("0|CheckMacValue error");
  }

  // 設定的商店代號（與 provider 使用同一組 env）
  const configuredMerchantId =
    process.env.ECPAY_MERCHANT_ID ??
    (process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
      ? undefined
      : "2000132");

  try {
    if (result.success) {
      // 防線 2：商店代號比對（金額比對與冪等在 settlePaidOrder 內）。
      // 不符時記錄異常、不結算，但仍回成功字串停止 ECPay 重送。
      if (result.merchantId !== configuredMerchantId) {
        console.error("[ecpay notify] merchant mismatch", {
          orderNo: result.orderNo,
          expectedMerchantId: configuredMerchantId,
          receivedMerchantId: result.merchantId,
        });
        return new Response("1|OK");
      }
      const settled = await settlePaidOrder({
        orderNo: result.orderNo,
        amount: result.amount,
        tradeNo: result.tradeNo,
        paymentType: result.paymentType,
        raw: payload,
      });
      if (!settled.ok) {
        console.error("[ecpay notify] 結算拒絕", {
          orderNo: result.orderNo,
          reason: settled.reason,
        });
      }
    } else {
      await settleFailedOrder(result.orderNo, payload);
    }
  } catch (error) {
    console.error("[ecpay notify] error:", error);
    return new Response("0|ServerError");
  }

  return new Response("1|OK");
}
