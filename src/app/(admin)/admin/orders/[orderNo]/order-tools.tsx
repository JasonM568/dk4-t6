"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  queryPaymentStatusAction,
  reconcileOrderAction,
  retryInvoiceAction,
} from "@/actions/orders";

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

  const canReconcile = orderStatus === "PENDING" || orderStatus === "FAILED";
  const canRetryInvoice =
    orderStatus === "PAID" && total > 0 && invoiceStatus !== "ISSUED";

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
