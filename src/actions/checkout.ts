"use server";

import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { computeDiscount, TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";

export type CheckoutResult =
  | { ok: true; action: string; fields: Record<string, string> }
  | { ok: false; error: string; redirect?: string };

/** 產生 ≤20 字元的訂單編號（ECPay MerchantTradeNo 限制）*/
function genOrderNo(): string {
  return "OD" + Date.now() + Math.floor(Math.random() * 900 + 100); // 18 碼數字
}

/**
 * 建立訂單並回傳 ECPay 付款表單欄位。
 * 折扣依「下單當下」的會員等級在 server 端計算，前端無法竄改。
 */
export async function createCheckout(courseId: string): Promise<CheckoutResult> {
  const user = await getAuthUser();
  if (!user) {
    return { ok: false, error: "請先登入", redirect: "/login" };
  }
  const userId = user.id;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course || !course.isPublished) {
    return { ok: false, error: "課程不存在" };
  }

  // 已購買者不可重複購買
  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (existing) {
    return { ok: false, error: "你已擁有此課程", redirect: "/my-courses" };
  }

  // 讀取會員等級折扣（MemberStats 是 lazy upsert，沒有就視為無折扣）
  // 分級制度停用時一律原價，不查等級
  const stats = TIER_SYSTEM_ENABLED
    ? await prisma.memberStats.findUnique({
        where: { userId },
        include: { currentTier: true },
      })
    : null;
  const discountPercent = stats?.currentTier?.discountPercent ?? 0;
  const tierLevel = stats?.currentTier?.level ?? 0;

  const subtotal = course.price;
  const discount = computeDiscount(subtotal, discountPercent);
  const total = subtotal - discount;

  if (total <= 0) {
    return { ok: false, error: "此課程無法透過金流購買，請聯繫管理員開通觀看權限" };
  }

  const orderNo = genOrderNo();

  // 建立訂單 + 明細 + 付款紀錄（PENDING）
  await prisma.order.create({
    data: {
      orderNo,
      userId,
      buyerEmail: user.email, // 下單當下 email 快照（後台顯示與稽核用）
      status: "PENDING",
      subtotal,
      discount,
      total,
      tierAtOrder: tierLevel,
      items: {
        create: [{ courseId: course.id, unitPrice: course.price }],
      },
      payment: {
        create: {
          provider: process.env.PAYMENT_PROVIDER ?? "ecpay",
          status: "PENDING",
          amount: total,
        },
      },
    },
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const provider = getPaymentProvider();
  const { action, fields } = provider.createPayment({
    orderNo,
    amount: total,
    itemName: course.title,
    tradeDesc: "online-course-order",
    returnUrl: `${base}/api/payment/ecpay/notify`,
    resultUrl: `${base}/api/payment/ecpay/return`,
    clientBackUrl: `${base}/orders/${orderNo}`,
  });

  return { ok: true, action, fields };
}
