"use client";

import { useActionState, useState } from "react";
import { updateInvoicePolicyAction, type OrderActionState } from "@/actions/orders";
import type { InvoicePolicy } from "@/lib/invoice/policy";
import { SubmitButton } from "@/components/admin/submit-button";

const MODES = [
  {
    value: "AUTO_PAID",
    label: "完款就開立",
    desc: "金流付款成功（含後台補開通）當下自動開立。最省事，適合線上課這種付款即履約的商品。",
  },
  {
    value: "MANUAL",
    label: "手動開立",
    desc: "系統不自動開立，一律由管理員在訂單詳情頁按「開立發票」。適合要先人工核對再開票的情境。",
  },
  {
    value: "ON_STATUS",
    label: "按訂單狀態開立",
    desc: "訂單被標成指定狀態時自動開立。適合「付款後還要人工確認才算成立」的流程（例如實體課報名）。",
  },
] as const;

export function InvoicePolicyForm({ initial }: { initial: InvoicePolicy }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(
    updateInvoicePolicyAction,
    null,
  );
  const [mode, setMode] = useState<string>(initial.mode);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state?.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.success}
        </p>
      )}

      <div className="space-y-3">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`block cursor-pointer rounded-2xl border p-4 transition ${
              mode === m.value
                ? "border-black bg-gray-50"
                : "border-gray-200 hover:border-gray-400"
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="h-4 w-4"
              />
              <span className="font-medium">{m.label}</span>
            </div>
            <p className="mt-1 pl-7 text-sm text-gray-500">{m.desc}</p>
            {m.value === "ON_STATUS" && mode === "ON_STATUS" && (
              <div className="mt-3 pl-7">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gray-600">訂單標成</span>
                  <select
                    name="triggerStatus"
                    defaultValue={initial.triggerStatus}
                    className="rounded-lg border border-gray-300 px-2 py-1.5"
                  >
                    <option value="CONFIRMED">已確認</option>
                    <option value="COMPLETED">已完成</option>
                  </select>
                  <span className="text-gray-600">時自動開立</span>
                </label>
              </div>
            )}
          </label>
        ))}
      </div>
      {/* mode!==ON_STATUS 時仍要送出 triggerStatus 預設值，避免驗證失敗 */}
      {mode !== "ON_STATUS" && (
        <input type="hidden" name="triggerStatus" value={initial.triggerStatus} />
      )}

      <SubmitButton className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800">
        儲存設定
      </SubmitButton>
    </form>
  );
}
