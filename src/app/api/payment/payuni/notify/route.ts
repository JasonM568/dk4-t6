import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider, type PayuniVerifyResult } from "@/lib/payment/payuni";
import { recalcTier } from "@/lib/membership/tier";
import { getEzpayConfig, issueInvoice } from "@/lib/invoice/ezpay";
import { getProfile } from "@/lib/supabase/admin";

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
 * 防線沿用 ECPay route 的五道：驗章、冪等、金額/商店比對、enrollment 唯一鍵。
 * 回應：PAYUNi 收到 HTTP 200 即停止重送。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
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

  // 防線 1：驗章／解密失敗直接拒絕（400 讓 PAYUNi 重送，人為偽造則無所謂）
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

  const configuredMerchantId = process.env.PAYUNI_MER_ID;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNo: result.orderNo },
        include: { items: true },
      });
      if (!order) {
        console.warn("[payuni notify] 訂單不存在", { orderNo: result.orderNo });
        return;
      }

      // 防線 2：已付款訂單直接略過（冪等——PAYUNi 有重送機制）
      if (order.status === "PAID") return;

      if (result.tradeState === "paid") {
        // 防線 3：金額與商店代號比對，防偽造成功回呼開通課程。
        // 不符時記錄異常、不開通，但回 200 停止重送（回 4xx 只會一直重打）。
        if (result.amount !== order.total || result.merchantId !== configuredMerchantId) {
          console.error("[payuni notify] 金額/商店比對不符", {
            orderNo: result.orderNo,
            expectedAmount: order.total,
            receivedAmount: result.amount,
            merchantMatches: result.merchantId === configuredMerchantId,
          });
          return;
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: "PAID", paidAt: new Date(), checkoutKey: null },
        });
        await tx.payment.update({
          where: { orderId: order.id },
          data: {
            status: "SUCCESS",
            tradeNo: result.tradeNo,
            paymentType: result.paymentType,
            rawCallback: payload,
            notifiedAt: new Date(),
          },
        });

        // 防線 4：enrollment upsert（@@unique 保證不重複授權）
        for (const item of order.items) {
          await tx.enrollment.upsert({
            where: {
              userId_courseId: { userId: order.userId, courseId: item.courseId },
            },
            update: {},
            create: {
              userId: order.userId,
              courseId: item.courseId,
              orderId: order.id,
              source: "PURCHASE",
            },
          });
        }

        await tx.memberStats.upsert({
          where: { userId: order.userId },
          update: {
            totalSpent: { increment: order.total },
            coursesBought: { increment: order.items.length },
          },
          create: {
            userId: order.userId,
            totalSpent: order.total,
            coursesBought: order.items.length,
          },
        });
        await recalcTier(tx, order.userId);
      } else {
        // failed：付款失敗/取消。釋放 checkoutKey 讓學員能重新下單
        await tx.order.update({
          where: { id: order.id },
          data: { status: "FAILED", checkoutKey: null },
        });
        await tx.payment.update({
          where: { orderId: order.id },
          data: { status: "FAILED", rawCallback: payload, notifiedAt: new Date() },
        });
      }
    });
  } catch (error) {
    console.error("[payuni notify] error:", error);
    return new Response("server error", { status: 500 });
  }

  // 電子發票（ezPay）：付款成功才開，且在 transaction 之外——外部 API 不能拖住
  // 開通課程；開票失敗只記 InvoiceRecord.error，不影響訂單，之後可重試。
  // await 完才回 200：serverless function 回應後就凍結，fire-and-forget 會被砍掉。
  if (result.tradeState === "paid") {
    await issueInvoiceForOrder(result.orderNo);
  }

  return new Response("OK");
}

/** 幫已付款訂單開立電子發票（冪等：已開立過直接略過） */
async function issueInvoiceForOrder(orderNo: string): Promise<void> {
  const config = getEzpayConfig();
  if (!config) return; // 未設定 ezPay = 發票功能未啟用，靜默略過

  try {
    const order = await prisma.order.findUnique({
      where: { orderNo },
      include: { items: { include: { course: { select: { title: true } } } } },
    });
    // 只開真的付款成功的單；金額 0 不開（免費開通不產生銷售額）
    if (!order || order.status !== "PAID" || order.total <= 0) return;

    const existing = await prisma.invoiceRecord.findUnique({ where: { orderId: order.id } });
    if (existing?.status === "ISSUED") return; // 冪等：PAYUNi 重送通知不會重複開票

    const buyerEmail = order.buyerEmail ?? "";
    if (!buyerEmail) {
      console.error("[invoice] 訂單缺買受人信箱，無法開立", { orderNo });
      return;
    }
    const profile = await getProfile(order.userId).catch(() => null);
    const buyerName = profile?.display_name || buyerEmail.split("@")[0];
    const itemName = order.items[0]?.course.title ?? "線上課程";

    const record = await prisma.invoiceRecord.upsert({
      where: { orderId: order.id },
      update: { attempts: { increment: 1 } },
      create: {
        orderId: order.id,
        orderNo,
        buyerEmail,
        totalAmt: order.total,
        attempts: 1,
      },
    });

    const res = await issueInvoice(config, {
      orderNo,
      buyerName,
      buyerEmail,
      itemName,
      totalAmt: order.total,
    });

    if (res.ok) {
      await prisma.invoiceRecord.update({
        where: { id: record.id },
        data: {
          status: "ISSUED",
          invoiceNumber: res.invoiceNumber,
          randomNum: res.randomNum,
          invoiceTransNo: res.invoiceTransNo,
          issuedAt: new Date(),
          error: null,
          raw: JSON.parse(JSON.stringify(res.raw)),
        },
      });
      console.log("[invoice] 開立成功", { orderNo, invoiceNumber: res.invoiceNumber });
    } else {
      await prisma.invoiceRecord.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          error: res.error,
          ...(res.raw ? { raw: JSON.parse(JSON.stringify(res.raw)) } : {}),
        },
      });
      console.error("[invoice] 開立失敗（訂單狀態不受影響，可後補）", {
        orderNo,
        error: res.error,
      });
    }
  } catch (e) {
    // 開票的任何例外都不能讓 notify 回非 200（PAYUNi 會一直重送）
    console.error("[invoice] 開立流程例外", { orderNo, e });
  }
}
