import { prisma } from "@/lib/db";
import { recalcTier } from "@/lib/membership/tier";
import { getEzpayConfig, issueInvoice } from "@/lib/invoice/ezpay";
import { getProfile } from "@/lib/supabase/admin";
import type { Prisma } from "@prisma/client";

// 訂單結算共用邏輯：PAYUNi notify（webhook）與後台「金流確認/補開通」「重開發票」
// 都走這裡——同一件事絕不寫兩份，兩邊行為不一致是金流事故的溫床。

export type SettleInput = {
  orderNo: string;
  /** 金流商回報／查詢到的實付金額，結算前與訂單金額比對（防偽造） */
  amount: number;
  tradeNo?: string;
  paymentType?: string;
  /** 存證：notify 的原始 payload 或查詢 API 的回應 */
  raw: Record<string, string>;
};

export type SettleResult =
  | { ok: true; already: boolean } // already=true 表示先前已結算（冪等路徑）
  | { ok: false; reason: "NOT_FOUND" | "AMOUNT_MISMATCH" | "CANCELLED" | "DUPLICATE_PAID" };

/** 已擁有課程視同「已付款且有效」的狀態（不含 REFUNDED/CANCELLED——那代表不再擁有）。
 *  用來判定「這筆是不是同一門課的第二次付款」。 */
const OWNED_STATUSES = ["PAID", "CONFIRMED", "COMPLETED"] as const;

/** 視同「已結算」的狀態：PAID 之後的營運態（已確認/已完成）都算。
 *  重送的付款通知打到這些狀態一律走冪等路徑——漏了任何一個，
 *  管理員把單標成已確認後，下一次重送就會重複累計消費與開通。 */
const SETTLED_STATUSES = new Set(["PAID", "CONFIRMED", "COMPLETED", "REFUNDED"]);

/** 把訂單標為已付款並開通課程（冪等）。只做 DB transaction，發票另呼叫
 *  issueInvoiceForOrder——外部 API 不能包在 transaction 裡。 */
export async function settlePaidOrder(input: SettleInput): Promise<SettleResult> {
  let outcome: SettleResult = { ok: true, already: false };

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNo: input.orderNo },
      include: { items: true },
    });
    if (!order) {
      outcome = { ok: false, reason: "NOT_FOUND" };
      return;
    }
    if (SETTLED_STATUSES.has(order.status)) {
      outcome = { ok: true, already: true };
      return;
    }
    // 已取消的單收到付款通知：不自動翻盤（可能是取消後學員仍完成付款），
    // 記錄異常讓管理員人工處理退款
    if (order.status === "CANCELLED") {
      console.error("[settle] 已取消訂單收到付款通知，需人工處理退款", {
        orderNo: input.orderNo,
      });
      outcome = { ok: false, reason: "CANCELLED" };
      return;
    }
    // 金額比對：金流商說收了多少就得跟訂單一致，不符即拒絕結算
    if (input.amount !== order.total) {
      outcome = { ok: false, reason: "AMOUNT_MISMATCH" };
      return;
    }

    // 防重複收款：該會員是否已有「同課、非本單、仍有效已付款」的訂單？
    // 典型情境——ATM 取號後這張被 lazy expire、學員又刷卡付了另一張拿到課，
    // 隔天原 ATM 才入帳打回這裡：金額必然相等、狀態非 SETTLED，會被前面的檢查放行，
    // 導致同一門課收兩次錢、totalSpent 雙計。退款無法自動化（PAYUNi 後台人工），
    // 這裡拒絕結算、不重複開通/累計，把重複標記寫進 Payment 留痕並告警等人工退款。
    const courseIds = order.items.map((i) => i.courseId);
    const dup = await tx.order.findFirst({
      where: {
        userId: order.userId,
        id: { not: order.id },
        status: { in: [...OWNED_STATUSES] },
        items: { some: { courseId: { in: courseIds } } },
      },
      select: { orderNo: true },
    });
    if (dup) {
      console.error(
        "[settle] 重複付款：該會員已有同課的有效已付款訂單，拒絕結算、需人工退款",
        { orderNo: input.orderNo, existingOrderNo: dup.orderNo, courseIds },
      );
      // 留痕：把款項與重複來源寫進 Payment.rawCallback，後台/查詢查得到
      await tx.payment.update({
        where: { orderId: order.id },
        data: {
          tradeNo: input.tradeNo,
          paymentType: input.paymentType,
          notifiedAt: new Date(),
          rawCallback: {
            ...(input.raw as Record<string, string>),
            _duplicatePaymentOf: dup.orderNo,
            _needsRefund: true,
          } as Prisma.InputJsonValue,
        },
      });
      outcome = { ok: false, reason: "DUPLICATE_PAID" };
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
        tradeNo: input.tradeNo,
        paymentType: input.paymentType,
        rawCallback: input.raw as Prisma.InputJsonValue,
        notifiedAt: new Date(),
      },
    });
    for (const item of order.items) {
      await tx.enrollment.upsert({
        where: { userId_courseId: { userId: order.userId, courseId: item.courseId } },
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
  });

  return outcome;
}

/** 把訂單標為付款失敗並釋放防重鍵（可重新下單） */
export async function settleFailedOrder(
  orderNo: string,
  raw: Record<string, string>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { orderNo } });
    // 已結算/已取消的單不因遲到的失敗通知翻盤
    if (!order || SETTLED_STATUSES.has(order.status) || order.status === "CANCELLED") return;
    await tx.order.update({
      where: { id: order.id },
      data: { status: "FAILED", checkoutKey: null },
    });
    await tx.payment.update({
      where: { orderId: order.id },
      data: {
        status: "FAILED",
        rawCallback: raw as Prisma.InputJsonValue,
        notifiedAt: new Date(),
      },
    });
  });
}

export type InvoiceIssueOutcome =
  | { ok: true; invoiceNumber: string; already: boolean }
  | { ok: false; error: string };

/** 幫已付款訂單開立電子發票（冪等：ISSUED 直接回傳既有號碼）。
 *  失敗只記 InvoiceRecord，絕不 throw——呼叫端（webhook/後台按鈕）都不受影響。 */
export async function issueInvoiceForOrder(orderNo: string): Promise<InvoiceIssueOutcome> {
  const config = getEzpayConfig();
  if (!config) return { ok: false, error: "EZPAY_INVOICE_* 環境變數未設定" };

  try {
    const order = await prisma.order.findUnique({
      where: { orderNo },
      include: { items: { include: { course: { select: { title: true } } } } },
    });
    if (!order) return { ok: false, error: "訂單不存在" };
    // 已確認/已完成也是付款後的狀態，補開發票要放行
    if (!SETTLED_STATUSES.has(order.status) || order.status === "REFUNDED") {
      return { ok: false, error: "訂單尚未付款，不可開立發票" };
    }
    if (order.total <= 0) return { ok: false, error: "金額 0 的訂單不開立發票" };

    const existing = await prisma.invoiceRecord.findUnique({ where: { orderId: order.id } });
    if (existing?.status === "ISSUED") {
      return { ok: true, invoiceNumber: existing.invoiceNumber ?? "", already: true };
    }

    const buyerEmail = order.buyerEmail ?? "";
    if (!buyerEmail) return { ok: false, error: "訂單缺買受人信箱" };
    const profile = await getProfile(order.userId).catch(() => null);
    const buyerName = profile?.display_name || buyerEmail.split("@")[0];
    const itemName = order.items[0]?.course.title ?? "線上課程";

    const record = await prisma.invoiceRecord.upsert({
      where: { orderId: order.id },
      update: { attempts: { increment: 1 } },
      create: { orderId: order.id, orderNo, buyerEmail, totalAmt: order.total, attempts: 1 },
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
    console.error("[invoice] 開立失敗（訂單狀態不受影響，可後補）", { orderNo, error: res.error });
    return { ok: false, error: res.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知錯誤";
    console.error("[invoice] 開立流程例外", { orderNo, e });
    return { ok: false, error: msg };
  }
}
