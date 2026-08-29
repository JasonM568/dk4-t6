"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider, payuniQueryTrade } from "@/lib/payment/payuni";
import { settlePaidOrder, issueInvoiceForOrder } from "@/lib/payment/settle";

// 訂單管理後台 actions：金流確認（向 PAYUNi 核對）、補開通、發票重開、
// 付款名單拋回名單群組。結算走 settle.ts 共用邏輯，與 webhook 行為一致。

export type OrderActionState = { error?: string; success?: string } | null;

function getPayuniOrError():
  | { ok: true; provider: PayuniProvider }
  | { ok: false; error: string } {
  const provider = getPaymentProvider();
  if (!(provider instanceof PayuniProvider)) {
    return { ok: false, error: "目前金流不是 PAYUNi，無法向金流商查詢" };
  }
  return { ok: true, provider };
}

/** 向 PAYUNi 查這筆訂單的即時狀態（唯讀，不動資料）。
 *  用途：notify 沒到、學員說付了但訂單還是待付款——先查證再決定補開通。 */
export async function queryPaymentStatusAction(orderNo: string): Promise<{
  error?: string;
  status?: string;
  message?: string;
}> {
  await requireEditor();
  const p = getPayuniOrError();
  if (!p.ok) return { error: p.error };

  const config = {
    merchantId: process.env.PAYUNI_MER_ID!,
    hashKey: process.env.PAYUNI_HASH_KEY!,
    hashIV: process.env.PAYUNI_HASH_IV!,
    apiUrl: process.env.PAYUNI_API_URL!,
  };
  const res = await payuniQueryTrade(config, orderNo);
  if (!res.ok) return { error: `查詢失敗：${res.error}` };

  const TRADE_STATUS_LABEL: Record<string, string> = {
    "0": "取號成功（等待付款）",
    "1": "已付款",
    "2": "付款失敗",
    "3": "付款取消",
    "8": "訂單待確認",
  };
  return {
    status: res.tradeStatus,
    message: `PAYUNi 回報：${TRADE_STATUS_LABEL[res.tradeStatus] ?? res.tradeStatus}｜金額 ${res.amount}｜${res.paymentType ?? "?"}${res.tradeNo ? `｜序號 ${res.tradeNo}` : ""}`,
  };
}

/** 金流確認補開通：向 PAYUNi 查證「真的已付款」才結算——絕不無憑據手動標 PAID。
 *  結算走與 webhook 相同的 settlePaidOrder（金額比對、冪等、開通、等級重算），
 *  成功後一併補開發票。 */
export async function reconcileOrderAction(orderNo: string): Promise<OrderActionState> {
  await requireEditor();
  const p = getPayuniOrError();
  if (!p.ok) return { error: p.error };

  const config = {
    merchantId: process.env.PAYUNI_MER_ID!,
    hashKey: process.env.PAYUNI_HASH_KEY!,
    hashIV: process.env.PAYUNI_HASH_IV!,
    apiUrl: process.env.PAYUNI_API_URL!,
  };
  const res = await payuniQueryTrade(config, orderNo);
  if (!res.ok) return { error: `向 PAYUNi 查詢失敗：${res.error}` };
  if (res.tradeStatus !== "1") {
    return {
      error: `PAYUNi 回報此單不是已付款（狀態 ${res.tradeStatus}），不可補開通`,
    };
  }

  const settled = await settlePaidOrder({
    orderNo,
    amount: res.amount,
    tradeNo: res.tradeNo,
    paymentType: res.paymentType,
    raw: res.raw,
  });
  if (!settled.ok) {
    return {
      error:
        settled.reason === "AMOUNT_MISMATCH"
          ? `金額不符：PAYUNi 收款 ${res.amount} 與訂單金額不同，請人工查證`
          : "訂單不存在",
    };
  }

  const invoice = await issueInvoiceForOrder(orderNo);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNo}`);
  return {
    success: settled.already
      ? "此單先前已結算（無需變更）"
      : `已補開通${invoice.ok ? `，發票 ${invoice.invoiceNumber} 已開立` : `；發票開立失敗：${invoice.error}`}`,
  };
}

/** 重試開立發票（FAILED 或已付款但漏開）。冪等：已開立回傳既有號碼。 */
export async function retryInvoiceAction(orderNo: string): Promise<OrderActionState> {
  await requireEditor();
  const res = await issueInvoiceForOrder(orderNo);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNo}`);
  if (!res.ok) return { error: `開立失敗：${res.error}` };
  return {
    success: res.already
      ? `發票先前已開立：${res.invoiceNumber}`
      : `發票已開立：${res.invoiceNumber}`,
  };
}

/** 把「已付款訂單」的買家拋進名單群組（EDM 用）。
 *  email 為單位去重；同名群組存在即沿用（同 webinar/場次的慣例）。 */
export async function saveBuyersToMailGroupAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireEditor();
  const groupName = String(formData.get("groupName") ?? "").trim();
  if (!groupName) return { error: "請填寫名單群組名稱" };
  const days = Number(formData.get("days") ?? 0); // 0 = 全部期間

  const since =
    Number.isFinite(days) && days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : undefined;

  const orders = await prisma.order.findMany({
    where: { status: "PAID", ...(since ? { paidAt: { gte: since } } : {}) },
    select: { buyerEmail: true },
  });
  const emails = [
    ...new Set(
      orders
        .map((o) => o.buyerEmail?.toLowerCase())
        .filter((e): e is string => !!e && e.includes("@")),
    ),
  ];
  if (emails.length === 0) return { error: "沒有符合條件的已付款買家" };

  const group = await prisma.mailGroup.upsert({
    where: { name: groupName },
    update: {},
    create: { name: groupName },
  });
  // createMany + skipDuplicates：重複執行不會把人加兩次
  const { count } = await prisma.mailGroupMember.createMany({
    data: emails.map((email) => ({ groupId: group.id, email })),
    skipDuplicates: true,
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin/broadcast/groups");
  return {
    success: `已把 ${emails.length} 位已付款買家存入「${groupName}」（新增 ${count} 位，其餘原本就在名單內）`,
  };
}
