"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  queryPaymentStatusAction,
  reconcileOrderAction,
  retryInvoiceAction,
  updateOrderStatusAction,
} from "@/actions/orders";

/** 手動狀態選項（PAID/REFUNDED 由金流流程寫入，不在此列）。
 *  依當前狀態過濾：未付款的單看不到已確認/已完成；已付款的看不到退回選項。 */
const STATUS_OPTIONS: { value: string; label: string; needPaid?: boolean; needUnpaid?: boolean }[] = [
  { value: "PENDING", label: "待付款", needUnpaid: true },
  { value: "AWAITING_CONFIRM", label: "待確認", needUnpaid: true },
  { value: "CONFIRMED", label: "已確認", needPaid: true },
  { value: "COMPLETED", label: "已完成", needPaid: true },
];
const PAID_STATES = ["PAID", "CONFIRMED", "COMPLETED", "REFUNDED"];

/** 訂單操作工具列：金流確認（查 PAYUNi）、補開通、發票重開。
 *  補開通必經 PAYUNi 查證「真的已付款」——後台沒有無憑據手動標 PAID 的按鈕，
 *  這是刻意的：人工標記是金流對帳災難的起點。 */
export function OrderTools({
  orderNo,
  orderStatus,
  invoiceStatus,
  total,
}: {
  orderNo: string;
  orderStatus: string;
  invoiceStatus: string | null;
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(
    null,
  );

  type ToolResult = { error?: string; success?: string; message?: string } | null;
  const run = (fn: () => Promise<ToolResult>) => {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res) return;
      if (res.error) setMessage({ kind: "err", text: res.error });
      else if (res.success) {
        setMessage({ kind: "ok", text: res.success });
        router.refresh();
      } else if (res.message) setMessage({ kind: "info", text: res.message });
    });
  };

  const [newStatus, setNewStatus] = useState("");

  const isPaidNow = PAID_STATES.includes(orderStatus);
  const canReconcile =
    orderStatus === "PENDING" ||
    orderStatus === "FAILED" ||
    orderStatus === "AWAITING_CONFIRM";
  const canRetryInvoice =
    ["PAID", "CONFIRMED", "COMPLETED"].includes(orderStatus) &&
    total > 0 &&
    invoiceStatus !== "ISSUED";
  const statusOptions = STATUS_OPTIONS.filter(
    (o) =>
      o.value !== orderStatus &&
      (!o.needPaid || isPaidNow) &&
      (!o.needUnpaid || !isPaidNow),
  );

  return (
    <section className="rounded-2xl border border-gray-200 p-5">
      <h2 className="mb-3 text-base font-bold">操作</h2>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(() => queryPaymentStatusAction(orderNo))}
          disabled={pending}
          className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
        >
          🔍 向 PAYUNi 查詢狀態
        </button>
        {canReconcile && (
          <button
            onClick={() => {
              if (
                confirm(
                  "將向 PAYUNi 查證此單是否已付款；查證通過才會標記已付款並開通課程＋開立發票。繼續？",
                )
              )
                run(() => reconcileOrderAction(orderNo));
            }}
            disabled={pending}
            className="rounded-lg bg-green-700 px-3 py-1.5 text-sm text-white transition hover:bg-green-800 disabled:opacity-50"
          >
            ✓ 金流確認補開通
          </button>
        )}
        {canRetryInvoice && (
          <button
            onClick={() => run(() => retryInvoiceAction(orderNo))}
            disabled={pending}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            🧾 重試開立發票
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        沒有「手動標記已付款」——補開通一律先向 PAYUNi 查證實付，查證不過不放行。
      </p>

      {/* ── 手動狀態編輯 ── */}
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">變更狀態：</span>
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">選擇新狀態…</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!newStatus) return;
              run(() => updateOrderStatusAction(orderNo, newStatus));
              setNewStatus("");
            }}
            disabled={pending || !newStatus}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
          >
            套用
          </button>
          {orderStatus !== "CANCELLED" && (
            <button
              onClick={() => {
                if (
                  confirm(
                    isPaidNow
                      ? "此單已收款。取消後：退款請至 PAYUNi 後台執行、發票請至 ezPay 後台作廢。確定取消？"
                      : "確定取消此訂單？（學員之後可重新下單）",
                  )
                )
                  run(() => updateOrderStatusAction(orderNo, "CANCELLED"));
              }}
              disabled={pending}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              ✕ 取消訂單
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          「已付款/已退款」由金流流程寫入不可手動設定；未付款的單不可標已確認/已完成。
        </p>
      </div>
      {pending && <p className="mt-2 text-sm text-gray-500">處理中…</p>}
      {message && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "bg-green-50 text-green-700"
              : message.kind === "err"
                ? "bg-red-50 text-red-700"
                : "bg-blue-50 text-blue-800"
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
