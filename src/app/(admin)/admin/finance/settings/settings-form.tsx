"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  saveFinanceSettingsAction,
  type FinanceFormState,
} from "@/actions/session-finance";
import { SubmitButton } from "@/components/admin/submit-button";

export function SettingsForm({
  initial,
}: {
  initial: {
    invoiceTaxPct: number;
    incomeTaxPct: number;
    cardFeePct: number;
    cardInstallFeePct: number;
    atmMode: "UNIT" | "RATE";
    atmUnitFee: number;
    atmFeePct: number;
    remitUnitFee: number;
    shares: { name: string; pct: number }[];
    externalSharePct: number;
    internalPromoters: string;
  };
}) {
  const [state, action] = useActionState<FinanceFormState, FormData>(
    saveFinanceSettingsAction,
    null,
  );
  const [atmMode, setAtmMode] = useState<"UNIT" | "RATE">(initial.atmMode);
  const [shares, setShares] = useState(initial.shares);
  const totalPct = shares.reduce((n, s) => n + (Number.isFinite(s.pct) ? s.pct : 0), 0);

  const pctInput = (name: string, label: string, def: number, hint?: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-40 text-gray-600">{label}</span>
      <input
        name={name}
        defaultValue={def}
        inputMode="decimal"
        className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
      />
      %{hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-6">
        <section className="space-y-2 rounded-xl border border-gray-200 p-4">
          <h2 className="font-bold">自動費率</h2>
          {pctInput("invoiceTaxPct", "發票稅金（總收入 ×）", initial.invoiceTaxPct)}
          {pctInput("incomeTaxPct", "營所稅（總收入 ×）", initial.incomeTaxPct)}
          {pctInput("cardFeePct", "信用卡單筆（該收入 ×）", initial.cardFeePct)}
          {pctInput("cardInstallFeePct", "信用卡分期（該收入 ×）", initial.cardInstallFeePct)}
          <div className="flex items-center gap-2 text-sm">
            <span className="w-40 text-gray-600">ATM 手續費</span>
            <select
              name="atmMode"
              value={atmMode}
              onChange={(e) => setAtmMode(e.target.value as "UNIT" | "RATE")}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
            >
              <option value="UNIT">每筆固定（新版）</option>
              <option value="RATE">金額 ×%（分享會舊版）</option>
            </select>
            {atmMode === "UNIT" ? (
              <label className="flex items-center gap-1">
                $
                <input
                  name="atmUnitFee"
                  defaultValue={initial.atmUnitFee}
                  inputMode="numeric"
                  className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
                />
                /筆
                {/* 兩個欄位都要送出（server 端兩個都驗），沒顯示的用預設值 */}
                <input type="hidden" name="atmFeePct" value={initial.atmFeePct} />
              </label>
            ) : (
              <label className="flex items-center gap-1">
                <input
                  name="atmFeePct"
                  defaultValue={initial.atmFeePct}
                  inputMode="decimal"
                  className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
                />
                %
                <input type="hidden" name="atmUnitFee" value={initial.atmUnitFee} />
              </label>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="w-40 text-gray-600">分潤匯費（每位 ×）</span>
            $
            <input
              name="remitUnitFee"
              defaultValue={initial.remitUnitFee}
              inputMode="numeric"
              className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
            />
            /筆
            <span className="text-xs text-gray-400">筆數＝內部分潤人數；個別場次可在收支頁覆寫</span>
          </label>
        </section>

        <section className="space-y-2 rounded-xl border border-gray-200 p-4">
          <h2 className="font-bold">外部分潤（自動歸屬）</h2>
          <p className="text-xs text-gray-400">
            訂單匯入後依「推薦人」（優先）與銷售頁「推廣者-XXX專用」自動歸屬，
            基數只算該人的新生認列金額；內部人員不產生外部分潤。
          </p>
          {pctInput("externalSharePct", "外部分潤費率（新生毛收 ×）", initial.externalSharePct)}
          <label className="flex items-center gap-2 text-sm">
            <span className="w-40 shrink-0 text-gray-600">內部人員名單</span>
            <input
              name="internalPromoters"
              defaultValue={initial.internalPromoters}
              placeholder="顧及然、顧院長、孟宏、舒庭"
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5"
            />
          </label>
          <p className="pl-42 text-xs text-gray-400">
            用頓號或逗號分隔；比對用「包含」——填「孟宏」就擋得住「陳孟宏」
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-gray-200 p-4">
          <h2 className="font-bold">預設內部分潤</h2>
          <p className="text-xs text-gray-400">
            新場次的起始比例；個別場次在收支頁儲存過自己的比例後不受這裡影響。
          </p>
          <input type="hidden" name="sharesJson" value={JSON.stringify(shares)} />
          {shares.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <input
                value={s.name}
                onChange={(e) =>
                  setShares(shares.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                placeholder="姓名"
                className="w-32 rounded-lg border border-gray-300 px-2 py-1.5"
              />
              <input
                value={s.pct}
                inputMode="decimal"
                onChange={(e) =>
                  setShares(
                    shares.map((x, j) =>
                      j === i ? { ...x, pct: Number(e.target.value) || 0 } : x,
                    ),
                  )
                }
                className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
              />
              %
              <button
                type="button"
                onClick={() => setShares(shares.filter((_, j) => j !== i))}
                className="text-xs text-red-500 hover:underline"
              >
                移除
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShares([...shares, { name: "", pct: 0 }])}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              ＋ 加一位
            </button>
            <span className={`text-xs ${Math.abs(totalPct - 100) > 0.01 ? "text-amber-700" : "text-gray-400"}`}>
              合計 {totalPct}%
            </span>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <SubmitButton
            pendingText="儲存中…"
            className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            儲存設定
          </SubmitButton>
          {state?.success && <span className="text-sm text-green-700">✓ {state.success}</span>}
          {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      </form>

    </div>
  );
}
