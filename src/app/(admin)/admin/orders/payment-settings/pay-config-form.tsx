"use client";

import { useActionState, useState } from "react";
import { updatePayConfigAction, type OrderActionState } from "@/actions/orders";
import { INST_CHOICES, type PaymentToolConfig } from "@/lib/payment/pay-config";
import { SubmitButton } from "@/components/admin/submit-button";

const TOOLS: { key: keyof PaymentToolConfig; label: string; note?: string }[] = [
  { key: "credit", label: "信用卡（一次付清）" },
  { key: "atm", label: "ATM 轉帳", note: "取號後學員自行轉帳，完成自動開通" },
  { key: "cvs", label: "超商代碼繳費", note: "7-ELEVEN 多媒體機台，手續費 25 元/筆" },
  { key: "applePay", label: "Apple Pay" },
  { key: "googlePay", label: "Google Pay" },
];

export function PayConfigForm({ initial }: { initial: PaymentToolConfig }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(
    updatePayConfigAction,
    null,
  );
  const [instEnabled, setInstEnabled] = useState(initial.instEnabled);
  const [credit, setCredit] = useState(initial.credit);
  const selectedInst = new Set(initial.instOptions.split(",").map(Number));

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state?.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.success}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">付款方式</h2>
        {TOOLS.map((t) => (
          <label key={t.key} className="flex items-start gap-3">
            <input
              type="checkbox"
              name={t.key}
              defaultChecked={initial[t.key] as boolean}
              onChange={t.key === "credit" ? (e) => setCredit(e.target.checked) : undefined}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="text-sm font-medium">{t.label}</span>
              {t.note && <span className="block text-xs text-gray-500">{t.note}</span>}
            </span>
          </label>
        ))}
        <p className="text-xs text-gray-400">
          全部取消時系統會自動保底開啟信用卡（付款頁不能一個選項都沒有）。
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-bold">信用卡分期</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="instEnabled"
            checked={instEnabled}
            onChange={(e) => setInstEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">開放分期付款</span>
        </label>
        {instEnabled && !credit && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ 分期需要信用卡付款方式開啟才會生效。
          </p>
        )}
        {instEnabled && (
          <div className="space-y-3 pl-7">
            <div>
              <span className="mb-1 block text-xs text-gray-600">開放期數（可複選）</span>
              <div className="flex flex-wrap gap-3">
                {INST_CHOICES.map((n) => (
                  <label key={n} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="instOptions"
                      value={n}
                      defaultChecked={selectedInst.has(n)}
                      className="h-3.5 w-3.5"
                    />
                    {n} 期
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                實際可用期數依 PAYUNi 商店開通的銀行為準（各銀行手續費不同）。
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">
                分期門檻：單筆訂單滿多少元才顯示分期選項
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">滿 NT$</span>
                <input
                  type="number"
                  name="instMinAmount"
                  min={0}
                  step={1}
                  defaultValue={initial.instMinAmount}
                  className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                />
                <span className="text-sm text-gray-500">元（0 = 不設門檻）</span>
              </div>
            </label>
          </div>
        )}
      </section>

      <SubmitButton className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800">
        儲存設定
      </SubmitButton>
    </form>
  );
}
