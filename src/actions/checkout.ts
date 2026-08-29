"use server";

import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getPaymentProvider } from "@/lib/payment";
import { computeDiscount, TIER_SYSTEM_ENABLED } from "@/lib/membership/tier";
import { isCoursePublicActive } from "@/lib/course-access";
import { nextOrderNo } from "@/lib/order-no";
import { getPaymentToolConfig, resolvePayTools } from "@/lib/payment/pay-config";

export type CheckoutResult =
  | { ok: true; action: string; fields: Record<string, string> }
  | { ok: false; error: string; redirect?: string };

/** PENDING 訂單有效期：逾期在下次結帳時 lazy 轉 EXPIRED 並釋放防重鍵 */
const PENDING_EXPIRE_MS = 2 * 60 * 60 * 1000;

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

  // 結帳前置：訂購人姓名與電話必填（訂單/發票/上課通知都要用）。
  // 缺料導去補填頁，補完自動帶回課程頁繼續購買
  const memberProfile = await prisma.memberProfile
    .findUnique({ where: { userId } })
    .catch(() => null);
  if (!memberProfile?.name || !memberProfile.phone) {
    return {
      ok: false,
      error: "請先填寫姓名與手機（訂單與發票需要），填完會自動回到本頁",
      redirect: `/complete-profile?next=${encodeURIComponent(`/courses/${course.slug}`)}`,
    };
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

  // 訂購人快照：下單當下抓（結帳閘門已保證姓名/電話存在），
  // 之後會員改資料不影響歷史訂單
  const buyerName = memberProfile.name;
  const buyerPhone = memberProfile.phone;

  // 建立訂單 + 明細 + 付款紀錄（PENDING）。
  // 兩把唯一鍵各司其職：checkoutKey 擋「同人同課重複下單」；orderNo（代碼+日期+
  // 當日流水，可預測）擋「併發撞號」——撞號就換下一個流水重試，撞 checkoutKey
  // 才是真的重複下單。
  let orderId: string | null = null;
  let orderNo = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    orderNo = await nextOrderNo(course, attempt);
    try {
      const created = await prisma.order.create({
        data: {
          orderNo,
          checkoutKey: `${userId}:${courseId}`,
          userId,
          buyerEmail: user.email, // 下單當下快照（後台顯示與稽核用）
          buyerName,
          buyerPhone,
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
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
        if (target.includes("orderNo")) continue; // 併發撞流水號：換下一號重試
        return {
          ok: false,
          error:
            "你已有這門課的待付款訂單，請先完成付款；若不打算付款，2 小時後訂單自動失效即可重新下單",
        };
      }
      throw e;
    }
  }
  if (!orderId) {
    console.error("[checkout] 訂單編號連撞 4 次，放棄", { courseId });
    return { ok: false, error: "系統忙碌中，請稍後再試" };
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const provider = getPaymentProvider();
  try {
    const { action, fields } = provider.createPayment({
      orderNo,
      amount: total,
      itemName: course.title,
      tradeDesc: "online-course-order",
      // notify/return 路徑跟著 provider 走（ecpay → /api/payment/ecpay/*、
      // payuni → /api/payment/payuni/*），兩邊回呼格式不同不能混用同一條
      returnUrl: `${base}/api/payment/${provider.name}/notify`,
      resultUrl: `${base}/api/payment/${provider.name}/return`,
      clientBackUrl: `${base}/orders/${orderNo}`,
      // 支付工具依後台「付款設定」；分期門檻以這筆實付金額判斷
      payTools: resolvePayTools(await getPaymentToolConfig(), total),
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
