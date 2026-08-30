"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getPaymentProvider } from "@/lib/payment";
import { collectAttendees } from "@/lib/session-attendees";
import { classifyTiers, priceForTier } from "@/lib/session-student-tier";
import { isSamePerson } from "@/lib/session-roster";
import {
  makeWebOrderNo,
  signupState,
  CLOSED_MESSAGE,
  SIGNUP_REQUEST_STATUS,
} from "@/lib/session-signup-page";

export type SessionCheckoutResult =
  | { ok: true; action: string; fields: Record<string, string> }
  | { ok: false; error: string };

export type PricingPreview =
  | { ok: true; lines: { tier: "NEW" | "RETRAIN"; price: number }[]; total: number }
  | { ok: false };

/** 報名頁即時試算：依手機/email 判各人新舊生與價格（不建單、不收費）。
 *  純顯示用，實際定價一律在 createSessionCheckout 伺服器端重算。 */
export async function previewSessionPricing(
  slug: string,
  contacts: { phone?: string | null; email?: string | null }[],
): Promise<PricingPreview> {
  const session = await prisma.courseSession.findUnique({
    where: { signupSlug: slug.toLowerCase() },
    select: {
      signupPayMode: true,
      signupPrice: true,
      signupRetrainPrice: true,
      signupRetrainCourseIds: true,
    },
  });
  if (!session || session.signupPayMode !== "PLATFORM" || !session.signupPrice) {
    return { ok: false };
  }
  const tiers = await classifyTiers(contacts, session.signupRetrainCourseIds);
  const lines = tiers.map((t) => ({
    tier: t,
    price: priceForTier(t, session.signupPrice!, session.signupRetrainPrice),
  }));
  return { ok: true, lines, total: lines.reduce((s, l) => s + l.price, 0) };
}

/**
 * 場次報名頁「平台金流」結帳（訪客免登入）。
 * 建立 SessionSignupOrder（PENDING）→ 走既有 PAYUNi 建單（刷卡＋ATM）→ 回付款表單。
 * 付款成功由 /api/payment/<provider>/session-notify 結算成正式名單，這裡不寫名單。
 */
export async function createSessionCheckout(
  slug: string,
  formData: FormData,
): Promise<SessionCheckoutResult> {
  // 蜜罐：機器人填了隱藏欄位 → 裝作成功不建單（同 submitSignupAction）
  if (String(formData.get("hp_extra_note") ?? "").trim() !== "") {
    console.error("[session-checkout] 蜜罐觸發", { slug });
    return { ok: false, error: "報名資料有誤，請重新整理後再試" };
  }

  const session = await prisma.courseSession.findUnique({
    where: { signupSlug: slug.toLowerCase() },
  });
  if (!session) return { ok: false, error: "找不到這個報名頁" };
  if (session.signupPayMode !== "PLATFORM" || !session.signupPrice || session.signupPrice <= 0) {
    return { ok: false, error: "本場次未開放線上付款報名" };
  }

  const buyerEmail = String(formData.get("buyerEmail") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return { ok: false, error: "請填寫正確的 Email（報名確認信會寄到這裡）" };
  }

  const parsed = collectAttendees(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { attendees } = parsed;

  // 開放與名額：已確認名單（未延出）＋待確認申請＋未付款的線上訂單都算佔位，避免超賣
  const [roster, pendingReq, pendingOrders] = await Promise.all([
    prisma.sessionSignup.findMany({
      where: { sessionId: session.id, deferredToSessionId: null },
      select: { name: true, phone: true },
    }),
    prisma.sessionSignupRequest.count({
      where: { sessionId: session.id, status: SIGNUP_REQUEST_STATUS.PENDING },
    }),
    prisma.sessionSignupOrder.aggregate({
      where: { sessionId: session.id, status: "PENDING" },
      _sum: { quantity: true },
    }),
  ]);
  const taken = roster.length + pendingReq + (pendingOrders._sum.quantity ?? 0);

  const state = signupState({ session, taken, now: new Date() });
  if (!state.open) return { ok: false, error: CLOSED_MESSAGE[state.reason] };

  const remaining = session.signupQuota === null ? Infinity : session.signupQuota - taken;
  if (attendees.length > remaining) {
    return {
      ok: false,
      error:
        remaining <= 0
          ? "本場次名額已滿"
          : `本場次只剩 ${remaining} 個名額，無法一次報名 ${attendees.length} 位`,
    };
  }

  // 已在正式名單裡的人不重複報名
  for (const a of attendees) {
    if (roster.some((r) => isSamePerson(r, a))) {
      return {
        ok: false,
        error: `「${a.name}」已經報名過這個場次了。若確定是同名的不同人，請確認手機號碼填的是本人的`,
      };
    }
  }

  // 自動新舊生判定（伺服器端重算，前端改不了價）：逐位查手機/email 的上課史，
  // 上過任一複訓資格課程＝複訓價，否則新生價。isRetrain 一律以自動判定為準（覆蓋手動勾選）。
  const tiers = await classifyTiers(
    attendees.map((a) => ({ phone: a.phone, email: a.email })),
    session.signupRetrainCourseIds,
  );
  const priced = attendees.map((a, i) => ({
    ...a,
    isRetrain: tiers[i] === "RETRAIN",
    tier: tiers[i],
    price: priceForTier(tiers[i], session.signupPrice!, session.signupRetrainPrice),
  }));
  const total = priced.reduce((sum, a) => sum + a.price, 0);
  const unitPrice = session.signupPrice!; // 名目新生價；混合定價的實際明細在 attendees 快照
  const buyer = priced[0];
  const provider = getPaymentProvider();

  // 建 SessionSignupOrder（PENDING）。checkoutKey 擋「同場次同信箱重複下單」，
  // orderNo 隨機不可枚舉；撞 orderNo 換一個重試，撞 checkoutKey 才是重複下單。
  let orderId: string | null = null;
  let orderNo = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    orderNo = makeWebOrderNo();
    try {
      const created = await prisma.sessionSignupOrder.create({
        data: {
          orderNo,
          sessionId: session.id,
          checkoutKey: `${session.id}:${buyerEmail}`,
          buyerEmail,
          buyerName: buyer.name,
          buyerPhone: buyer.phone,
          attendees: priced as unknown as Prisma.InputJsonValue,
          quantity: priced.length,
          unitPrice,
          total,
          status: "PENDING",
          provider: provider.name,
        },
        select: { id: true },
      });
      orderId = created.id;
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
        if (target.includes("orderNo")) continue; // 併發撞號：換一個重試
        return {
          ok: false,
          error:
            "你已有這個場次的待付款報名，請先完成付款；若不打算付款，稍後訂單失效即可重新報名",
        };
      }
      throw e;
    }
  }
  if (!orderId) {
    console.error("[session-checkout] 訂單編號連撞 4 次，放棄", { slug });
    return { ok: false, error: "系統忙碌中，請稍後再試" };
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  try {
    const itemName =
      attendees.length > 1 ? `${session.title}（${attendees.length} 位）` : session.title;
    const { action, fields } = provider.createPayment({
      orderNo,
      amount: total,
      itemName,
      tradeDesc: "session-signup-order",
      // 場次專屬 notify/return，與課程訂單的路徑分開（結算對象是 SessionSignupOrder）
      returnUrl: `${base}/api/payment/${provider.name}/session-notify`,
      resultUrl: `${base}/api/payment/${provider.name}/session-return`,
      clientBackUrl: `${base}/event/${slug}`,
      // 報名頁固定開放刷卡＋ATM 兩種，不開超商/錢包/分期
      payTools: {
        credit: true,
        atm: true,
        cvs: false,
        applePay: false,
        googlePay: false,
      },
    });
    return { ok: true, action, fields };
  } catch (e) {
    console.error("[session-checkout] 建立付款表單失敗：", e);
    await prisma.sessionSignupOrder
      .update({ where: { id: orderId }, data: { status: "FAILED", checkoutKey: null } })
      .catch(() => undefined);
    return { ok: false, error: "建立付款連結失敗，請稍後再試" };
  }
}
