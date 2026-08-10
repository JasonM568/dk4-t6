"use server";

import { randomBytes } from "crypto";
import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getPaymentProvider } from "@/lib/payment";
import { computeDiscount, TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { isCoursePublicActive } from "@/lib/course-access";

export type CheckoutResult =
  | { ok: true; action: string; fields: Record<string, string> }
  | { ok: false; error: string; redirect?: string };

/** PENDING 訂單有效期：逾期在下次結帳時 lazy 轉 EXPIRED 並釋放防重鍵 */
const PENDING_EXPIRE_MS = 2 * 60 * 60 * 1000;

/** 產生 20 字元訂單編號（ECPay MerchantTradeNo 上限）。
 *  加密安全亂數、不可預測——orderNo 會出現在 /orders/[orderNo] URL，
 *  時間戳＋Math.random 可被猜號枚舉 */
function genOrderNo(): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(18);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return "OD" + s;
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
  // 企業專區課程（groupId 有值）不販售，一律視同不存在，堵住拿 courseId 直接下單
  if (!course || !isCoursePublicActive(course) || course.groupId) {
    return { ok: false, error: "課程不存在" };
  }

  // 已購買者不可重複購買
  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (existing) {
    return { ok: false, error: "你已擁有此課程", redirect: "/my-courses" };
  }

  // 逾期 PENDING lazy 轉 EXPIRED 並釋放防重鍵——舊訂單不會永久擋住重新購買
  await prisma.order.updateMany({
    where: {
      userId,
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - PENDING_EXPIRE_MS) },
    },
    data: { status: "EXPIRED", checkoutKey: null },
  });

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

  // 建立訂單 + 明細 + 付款紀錄（PENDING）。
  // 防重不靠「先查再建」：checkoutKey nullable unique，併發下單第二筆直接撞
  // unique violation（P2002），資料庫層保證同課程同時最多一筆有效 PENDING
  let orderId: string;
  try {
    const created = await prisma.order.create({
      data: {
        orderNo,
        checkoutKey: `${userId}:${courseId}`,
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
      select: { id: true },
    });
    orderId = created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        error:
          "你已有這門課的待付款訂單，請先完成付款；若不打算付款，2 小時後訂單自動失效即可重新下單",
      };
    }
    throw e;
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const provider = getPaymentProvider();
  try {
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
  } catch (e) {
    // 金流表單建立失敗：訂單轉 FAILED 並釋放防重鍵，使用者可立刻重試，
    // 不留下永久 PENDING
    console.error("[checkout] 建立付款表單失敗：", e);
    await prisma.order
      .update({
        where: { id: orderId },
        data: { status: "FAILED", checkoutKey: null },
      })
      .catch(() => undefined);
    return { ok: false, error: "建立付款連結失敗，請稍後再試" };
  }
}
