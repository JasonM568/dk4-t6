import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { recalcTier } from "@/lib/membership/tier";

// ECPay 簽章需要 node:crypto，禁用 edge runtime
export const runtime = "nodejs";

/**
 * ECPay server-to-server 背景通知（ReturnURL）。
 * 這是訂單付款狀態的「唯一真實來源」。必須回傳純文字 "1|OK"。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = String(value);
  });

  const provider = getPaymentProvider();
  const result = provider.verifyCallback(payload);

  // 防線 1：驗章失敗直接拒絕
  if (!result.valid) {
    return new Response("0|CheckMacValue error");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNo: result.orderNo },
        include: { items: true },
      });
      if (!order) return;

      // 防線 2：已處理過的訂單直接略過（冪等）
      if (order.status === "PAID") return;

      if (result.success) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "PAID", paidAt: new Date() },
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

        // 防線 3：建立 enrollment（@@unique 保證不重複授權）
        for (const item of order.items) {
          await tx.enrollment.upsert({
            where: {
              userId_courseId: {
                userId: order.userId,
                courseId: item.courseId,
              },
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

        // 累加消費並重算會員等級
        // MemberStats 採 lazy upsert：首次付款成功時建立，之後累加
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
        await tx.order.update({
          where: { id: order.id },
          data: { status: "FAILED" },
        });
        await tx.payment.update({
          where: { orderId: order.id },
          data: {
            status: "FAILED",
            rawCallback: payload,
            notifiedAt: new Date(),
          },
        });
      }
    });
  } catch (error) {
    console.error("[ecpay notify] error:", error);
    return new Response("0|ServerError");
  }

  return new Response("1|OK");
}
