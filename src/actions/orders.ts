"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor, requireFullAdmin } from "@/lib/auth/staff";
import { getPaymentProvider } from "@/lib/payment";
import { PayuniProvider, payuniQueryTrade } from "@/lib/payment/payuni";
import { settlePaidOrder, issueInvoiceForOrder } from "@/lib/payment/settle";
import {
  getPaymentToolConfig,
  setPaymentToolConfig,
  normalizeInstOptions,
} from "@/lib/payment/pay-config";
import {
  getInvoicePolicy,
  setInvoicePolicy,
  INVOICE_MODES,
  INVOICE_TRIGGER_STATUSES,
  type InvoiceMode,
  type InvoicePolicy,
} from "@/lib/invoice/policy";

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

  // 發票依政策：完款就開立才自動開；手動/按狀態模式留給後續操作
  let invoiceNote = "";
  if (!settled.already && (await getInvoicePolicy()).mode === "AUTO_PAID") {
    const invoice = await issueInvoiceForOrder(orderNo);
    invoiceNote = invoice.ok
      ? `，發票 ${invoice.invoiceNumber} 已開立`
      : `；發票開立失敗：${invoice.error}`;
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNo}`);
  return {
    success: settled.already ? "此單先前已結算（無需變更）" : `已補開通${invoiceNote}`,
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

/** 手動可設定的狀態白名單。
 *  PAID 刻意不在內：已付款只能由金流結算寫入（webhook 或「金流確認補開通」），
 *  手動標已付款會讓帳跟金流商對不起來。REFUNDED 也鎖——退款請在 PAYUNi
 *  後台執行後再標記（之後可串退款 API）。 */
const MANUAL_STATUS_LABEL: Record<string, string> = {
  PENDING: "待付款",
  AWAITING_CONFIRM: "待確認",
  CONFIRMED: "已確認",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const MANUAL_STATUSES = [
  "PENDING",
  "AWAITING_CONFIRM",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
] as const;

/** 手動編輯訂單狀態（含手動取消）。
 *  規則：不可設 PAID/REFUNDED；未付款的單不可標已確認/已完成
 *  （已確認的語意是「付款後人工核對過」，沒付錢就確認等於白送課）。 */
export async function updateOrderStatusAction(
  orderNo: string,
  newStatus: string,
): Promise<OrderActionState> {
  await requireEditor();
  if (!(MANUAL_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "此狀態不可手動設定（已付款/已退款由金流流程寫入）" };
  }
  const order = await prisma.order.findUnique({ where: { orderNo } });
  if (!order) return { error: "訂單不存在" };
  if (order.status === newStatus) return { success: "狀態未變更" };

  const paidStates = ["PAID", "CONFIRMED", "COMPLETED", "REFUNDED"];
  const isPaidNow = paidStates.includes(order.status);

  // 沒付款的單不可標成付款後的營運態
  if (!isPaidNow && (newStatus === "CONFIRMED" || newStatus === "COMPLETED")) {
    return { error: "此單尚未付款，不可標記為已確認/已完成（請先走金流確認補開通）" };
  }
  // 付款後的單不可退回付款前的狀態（會讓重送的通知重複結算）
  if (isPaidNow && (newStatus === "PENDING" || newStatus === "AWAITING_CONFIRM")) {
    return { error: "已付款的訂單不可退回待付款/待確認" };
  }
  // 已付款訂單取消：允許（退款請另至 PAYUNi 後台執行），給明確提示
  const cancellingPaid = isPaidNow && newStatus === "CANCELLED";

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: newStatus as (typeof MANUAL_STATUSES)[number],
      // checkoutKey 只在 PENDING 擋併發下單，離開 PENDING 一律釋放。
      // 只清 CANCELLED 會讓「待確認」的單把 userId:courseId 鍵永久鎖死，
      // 該學員之後對這門課結帳一律撞 P2002，且錯誤訊息「2 小時後自動失效」是假的
      // （lazy expire 只掃 PENDING）。
      ...(newStatus === "PENDING" ? {} : { checkoutKey: null }),
    },
  });
  console.log("[orders] 手動變更狀態", { orderNo, from: order.status, to: newStatus });

  // 按訂單狀態開立：標到觸發狀態時自動開發票（冪等，已開立不重複）
  let invoiceNote = "";
  const policy = await getInvoicePolicy();
  if (policy.mode === "ON_STATUS" && newStatus === policy.triggerStatus) {
    const invoice = await issueInvoiceForOrder(orderNo);
    invoiceNote = invoice.ok
      ? invoice.already
        ? ""
        : `；發票 ${invoice.invoiceNumber} 已開立`
      : `；發票開立失敗：${invoice.error}（可稍後在詳情頁重試）`;
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderNo}`);
  return {
    success: cancellingPaid
      ? "已取消。注意：此單已收款，退款請至 PAYUNi 後台執行，發票請至 ezPay 後台作廢"
      : `狀態已更新為「${MANUAL_STATUS_LABEL[newStatus] ?? newStatus}」${invoiceNote}`,
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
    // 已確認/已完成也是付過款的人，一併納入
    where: {
      status: { in: ["PAID", "CONFIRMED", "COMPLETED"] },
      ...(since ? { paidAt: { gte: since } } : {}),
    },
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

/** 讀取發票開立政策（設定頁初始值用） */
export async function getInvoicePolicyAction(): Promise<InvoicePolicy> {
  await requireEditor();
  return getInvoicePolicy();
}

/** 更新發票開立政策（僅管理員——開立時機影響稅務申報節奏） */
export async function updateInvoicePolicyAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireFullAdmin();
  const mode = String(formData.get("mode") ?? "");
  const triggerStatus = String(formData.get("triggerStatus") ?? "CONFIRMED");
  if (!(INVOICE_MODES as readonly string[]).includes(mode)) {
    return { error: "開立模式不正確" };
  }
  if (!(INVOICE_TRIGGER_STATUSES as readonly string[]).includes(triggerStatus)) {
    return { error: "觸發狀態不正確" };
  }
  await setInvoicePolicy({
    mode: mode as InvoiceMode,
    triggerStatus: triggerStatus as InvoicePolicy["triggerStatus"],
  });
  revalidatePath("/admin/orders/invoice-settings");
  return { success: "發票開立政策已更新" };
}

/** 更新付款方式設定（僅管理員）。全部關掉時 lib 端保底信用卡。 */
export async function updatePayConfigAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  await requireFullAdmin();
  const on = (k: string) => formData.get(k) === "on";
  const minRaw = Number(String(formData.get("instMinAmount") ?? "0"));
  if (!Number.isFinite(minRaw) || minRaw < 0) {
    return { error: "分期門檻請填 0 或正整數（0 = 不設門檻）" };
  }
  const instOptions = formData
    .getAll("instOptions")
    .map(String)
    .join(",");
  await setPaymentToolConfig({
    credit: on("credit"),
    atm: on("atm"),
    cvs: on("cvs"),
    applePay: on("applePay"),
    googlePay: on("googlePay"),
    instEnabled: on("instEnabled"),
    instOptions: normalizeInstOptions(instOptions),
    instMinAmount: Math.round(minRaw),
  });
  revalidatePath("/admin/orders/payment-settings");
  const saved = await getPaymentToolConfig();
  const enabled = [
    saved.credit && "信用卡",
    saved.atm && "ATM",
    saved.cvs && "超商代碼",
    saved.applePay && "Apple Pay",
    saved.googlePay && "Google Pay",
  ].filter(Boolean).join("、");
  return {
    success: `已儲存。目前開放：${enabled}${saved.instEnabled ? `；分期 ${saved.instOptions} 期（滿 ${saved.instMinAmount} 元）` : "；分期關閉"}`,
  };
}
