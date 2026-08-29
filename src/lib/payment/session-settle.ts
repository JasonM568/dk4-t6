import { prisma } from "@/lib/db";
import { getEzpayConfig, issueInvoice } from "@/lib/invoice/ezpay";
import { attendeeKeyAt } from "@/lib/session-signup-page";
import { isRetrainProduct } from "@/lib/session-roster";
import type { Prisma } from "@prisma/client";

// 場次線上金流訂單結算：PAYUNi/ECPay 的 session-notify 共用。
// 對照課程訂單的 settle.ts——這裡把付款成功的 SessionSignupOrder 轉成正式名單
// （SessionSignup），而不是開通課程（Enrollment）。發票另呼叫（外部 API 不進 transaction）。

export type SessionSettleInput = {
  orderNo: string;
  amount: number;
  tradeNo?: string;
  paymentType?: string;
  raw: Record<string, string>;
};

export type SessionSettleResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: "NOT_FOUND" | "AMOUNT_MISMATCH" | "CANCELLED" };

/** 視同已結算的狀態：重送的付款通知一律走冪等路徑，不重複建名單。 */
const SETTLED_STATUSES = new Set(["PAID", "CONFIRMED", "COMPLETED", "REFUNDED"]);

type AttendeeSnapshot = {
  name: string;
  phone: string;
  email: string | null;
  meal: "MEAT" | "VEG";
  isRetrain: boolean;
};

/** 付款成功 → 場次訂單標 PAID、逐位參加者建 SessionSignup 進正式名單、加名單群組（冪等）。 */
export async function settleSessionPaidOrder(
  input: SessionSettleInput,
): Promise<SessionSettleResult> {
  let outcome: SessionSettleResult = { ok: true, already: false };

  await prisma.$transaction(async (tx) => {
    const order = await tx.sessionSignupOrder.findUnique({
      where: { orderNo: input.orderNo },
    });
    if (!order) {
      outcome = { ok: false, reason: "NOT_FOUND" };
      return;
    }
    if (SETTLED_STATUSES.has(order.status)) {
      outcome = { ok: true, already: true };
      return;
    }
    if (order.status === "CANCELLED") {
      console.error("[session-settle] 已取消訂單收到付款通知，需人工處理退款", {
        orderNo: input.orderNo,
      });
      outcome = { ok: false, reason: "CANCELLED" };
      return;
    }
    if (input.amount !== order.total) {
      outcome = { ok: false, reason: "AMOUNT_MISMATCH" };
      return;
    }

    await tx.sessionSignupOrder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        checkoutKey: null,
        tradeNo: input.tradeNo,
        paymentType: input.paymentType,
        rawCallback: input.raw as Prisma.InputJsonValue,
      },
    });

    // 逐位參加者建正式名單。SessionSignup 唯一鍵 (sessionId, orderNo, attendeeKey)——
    // 同一訂單各位同行者用不同 attendeeKey 不會撞；撞到＝重送已建過，略過即可。
    const attendees = (order.attendees as AttendeeSnapshot[]) ?? [];
    for (let i = 0; i < attendees.length; i++) {
      const a = attendees[i];
      const base = "網路報名";
      const product = a.isRetrain && !isRetrainProduct(base) ? `複訓｜${base}` : base;
      try {
        await tx.sessionSignup.create({
          data: {
            sessionId: order.sessionId,
            orderNo: order.orderNo,
            attendeeKey: attendeeKeyAt(i),
            name: a.name,
            email: a.email,
            phone: a.phone,
            product,
            meal: a.meal,
            orderedAt: order.createdAt,
          },
        });
      } catch (e) {
        console.error("[session-settle] 建立名單列失敗（可能重送已建）", {
          orderNo: order.orderNo,
          name: a.name,
          e,
        });
      }
    }

    // 訂購人加入名單群組（之後寄 EDM 用；失敗不影響報名成立）
    const session = await tx.courseSession.findUnique({
      where: { id: order.sessionId },
      select: { signupGroupId: true },
    });
    if (session?.signupGroupId) {
      try {
        await tx.mailGroupMember.upsert({
          where: {
            groupId_email: { groupId: session.signupGroupId, email: order.buyerEmail },
          },
          update: { name: order.buyerName },
          create: {
            groupId: session.signupGroupId,
            email: order.buyerEmail,
            name: order.buyerName,
          },
        });
      } catch (e) {
        console.error("[session-settle] 加入名單群組失敗", {
          orderNo: order.orderNo,
          e,
        });
      }
    }
  });

  return outcome;
}

/** 付款失敗 → 標 FAILED 並釋放防重鍵（可重新報名）。已結算/已取消不因遲到通知翻盤。 */
export async function settleSessionFailedOrder(
  orderNo: string,
  raw: Record<string, string>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.sessionSignupOrder.findUnique({ where: { orderNo } });
    if (!order || SETTLED_STATUSES.has(order.status) || order.status === "CANCELLED") return;
    await tx.sessionSignupOrder.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        checkoutKey: null,
        rawCallback: raw as Prisma.InputJsonValue,
      },
    });
  });
}

export type SessionInvoiceOutcome =
  | { ok: true; invoiceNumber: string; already: boolean }
  | { ok: false; error: string };

/** 幫已付款的場次訂單開立 ezPay 發票（冪等）。失敗只記 InvoiceRecord，絕不 throw。
 *  沿用課程訂單的 InvoiceRecord 表（orderId 存場次訂單 id，cuid 不與課程訂單相撞）。 */
export async function issueInvoiceForSessionOrder(
  orderNo: string,
): Promise<SessionInvoiceOutcome> {
  const config = getEzpayConfig();
  if (!config) return { ok: false, error: "EZPAY_INVOICE_* 環境變數未設定" };

  try {
    const order = await prisma.sessionSignupOrder.findUnique({ where: { orderNo } });
    if (!order) return { ok: false, error: "訂單不存在" };
    if (!SETTLED_STATUSES.has(order.status) || order.status === "REFUNDED") {
      return { ok: false, error: "訂單尚未付款，不可開立發票" };
    }
    if (order.total <= 0) return { ok: false, error: "金額 0 的訂單不開立發票" };
    if (!order.buyerEmail) return { ok: false, error: "訂單缺買受人信箱" };

    const existing = await prisma.invoiceRecord.findUnique({ where: { orderId: order.id } });
    if (existing?.status === "ISSUED") {
      return { ok: true, invoiceNumber: existing.invoiceNumber ?? "", already: true };
    }

    const session = await prisma.courseSession.findUnique({
      where: { id: order.sessionId },
      select: { title: true },
    });
    const itemName = session?.title ?? "課程報名";

    const record = await prisma.invoiceRecord.upsert({
      where: { orderId: order.id },
      update: { attempts: { increment: 1 } },
      create: {
        orderId: order.id,
        orderNo,
        buyerEmail: order.buyerEmail,
        totalAmt: order.total,
        attempts: 1,
      },
    });

    const res = await issueInvoice(config, {
      orderNo,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
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
      return { ok: true, invoiceNumber: res.invoiceNumber, already: false };
    }

    await prisma.invoiceRecord.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        error: res.error,
        ...(res.raw ? { raw: JSON.parse(JSON.stringify(res.raw)) } : {}),
      },
    });
    return { ok: false, error: res.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知錯誤";
    console.error("[session-settle] 開立發票流程例外", { orderNo, e });
    return { ok: false, error: msg };
  }
}
