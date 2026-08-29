"use client";

import { useState, useTransition } from "react";
import {
  confirmSignupRequestAction,
  cancelSignupRequestAction,
} from "@/actions/session-signup";

export type PendingAttendee = {
  name: string;
  phone: string | null;
  email: string | null;
  meal: string;
  isRetrain: boolean;
};

export type PendingOrder = {
  orderNo: string;
  buyerName: string;
  buyerEmail: string | null;
  buyerPhone: string | null;
  note: string | null;
  createdAt: string;
  attendees: PendingAttendee[];
};

export function PendingRequests({
  sessionId,
  orders,
}: {
  sessionId: string;
  orders: PendingOrder[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error?: string; success?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = (orderNo: string, action: "confirm" | "cancel") => {
    if (action === "cancel" && !confirm(`確定要取消報名 ${orderNo}？（不會刪除紀錄）`)) return;
    setBusy(orderNo);
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "confirm"
          ? await confirmSignupRequestAction(sessionId, orderNo)
          : await cancelSignupRequestAction(sessionId, orderNo);
      setBusy(null);
      setMessage(result);
    });
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
      <h2 className="mb-1 text-lg font-bold text-amber-900">
        待確認報名（{orders.length} 筆訂單）
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-amber-800">
        報名頁送出的人先進這裡，<strong>不會出現在看板名單、分組與課前通知</strong>。
        收到款項後按「確認收款，轉入名單」才會成為正式名單。
      </p>

      {message?.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {message.error}
        </p>
      )}
      {message?.success && (
        <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {message.success}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-gray-500">
          目前沒有待確認的報名
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.orderNo} className="rounded-xl border border-amber-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-gray-500">{o.orderNo}</span>
                <span className="text-sm font-medium">{o.buyerName}</span>
                {o.buyerEmail && (
                  <span className="text-xs text-gray-600">{o.buyerEmail}</span>
                )}
                {o.buyerPhone && (
                  <span className="text-xs text-gray-600">{o.buyerPhone}</span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date(o.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                </span>
              </div>

              <ul className="mb-3 space-y-1 text-sm">
                {o.attendees.map((a, i) => (
                  <li key={`${a.name}-${i}`} className="flex flex-wrap gap-x-2 text-gray-700">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-gray-500">{a.phone ?? "（無手機）"}</span>
                    {a.email && <span className="text-gray-400">{a.email}</span>}
                    <span className="text-gray-500">{a.meal === "VEG" ? "素" : "葷"}</span>
                    {a.isRetrain && (
                      <span className="rounded-full bg-indigo-100 px-2 text-xs text-indigo-700">
                        複訓
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {o.note && (
                <p className="mb-3 whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  備註：{o.note}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => run(o.orderNo, "confirm")}
                  disabled={pending && busy === o.orderNo}
                  className="rounded-lg bg-green-700 px-3 py-1.5 text-sm text-white transition hover:bg-green-800 disabled:opacity-50"
                >
                  ✓ 確認收款，轉入名單
                </button>
                <button
                  onClick={() => run(o.orderNo, "cancel")}
                  disabled={pending && busy === o.orderNo}
                  className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100 disabled:opacity-50"
                >
                  取消報名
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
