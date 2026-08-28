"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import {
  addCostAction,
  addManualIncomeAction,
  deleteCostAction,
  deleteManualOrderAction,
  saveSharesAction,
  setFinanceTemplateAction,
  setLineRecognitionAction,
  setLineStudentTypeAction,
  setOrderRecognizedAction,
  updateCostAction,
  updateManualIncomeAction,
  type FinanceFormState,
} from "@/actions/session-finance";
import type { FinanceResult } from "@/lib/finance/compute";
import {
  FINANCE_TEMPLATES,
  FINANCE_TEMPLATE_LABEL,
  extractPromoter,
  type FinanceTemplate,
} from "@/lib/finance/labels";
import { formatNT } from "@/lib/format";
import { SubmitButton } from "@/components/admin/submit-button";

// 單場收支結算的操作面板。版面完全對照他的 Excel：三段（收入／支出／分潤）＋
// 合計列＋警示。黃底 = 人工填入（與 Excel 的顏色語意一致）。

type OrderRow = {
  id: string;
  orderNo: string;
  source: string;
  buyerName: string;
  paymentMethod: string;
  paymentMethodRaw: string | null;
  isRecognized: boolean;
  excludeReason: string | null;
  refundedAt: string | null;
  refundAmount: number;
  manualOverride: boolean;
  salesPage: string | null;
  referrer: string | null;
  lines: {
    id: string;
    productRaw: string;
    planLabel: string;
    studentType: string | null;
    unitPrice: number;
    quantity: number;
    amount: number;
    recognizedAmount: number;
    recognizeNote: string | null;
    isOnsite: boolean;
  }[];
};

const METHOD_LABEL: Record<string, string> = {
  CREDIT_ONE: "信用卡單筆",
  CREDIT_INSTALLMENT: "信用卡分期",
  ATM: "ATM匯款",
  CASH: "現場付款",
  OTHER: "其他",
  UNKNOWN: "未知",
};

function Feedback({ state }: { state: FinanceFormState }) {
  if (!state) return null;
  if (state.error) return <span className="text-sm text-red-600">{state.error}</span>;
  if (state.success) return <span className="text-sm text-green-700">✓ {state.success}</span>;
  return null;
}

export function FinanceManager({
  sessionId,
  result,
  reconcile,
  orders,
  shares: initialShares,
  sharesSaved,
  template,
  templateStored,
}: {
  sessionId: string;
  result: FinanceResult;
  reconcile: { signupCount: number; orderCount: number; seatCount: number };
  orders: OrderRow[];
  shares: { name: string; pct: number }[];
  sharesSaved: boolean;
  template: FinanceTemplate;
  templateStored: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<FinanceFormState>(null);
  const run = (fn: () => Promise<FinanceFormState>) =>
    startTransition(async () => setFlash(await fn()));

  const mismatch =
    reconcile.signupCount !== reconcile.seatCount;

  return (
    <div className="space-y-8">
      {/* 收支表模板：量子拆手續費列、一般合併；AUTO = 依場次名稱判斷 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">收支表模板</span>
        <select
          value={template}
          disabled={pending}
          onChange={(e) => run(() => setFinanceTemplateAction(sessionId, e.target.value))}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
        >
          {FINANCE_TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {FINANCE_TEMPLATE_LABEL[t]}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400">
          {templateStored ? "本場已指定" : "依場次名稱自動判斷（切換後固定為本場設定）"}
          ・量子模板的刷卡/ATM 手續費拆新生/複訓兩列
        </span>
      </div>

      {/* 對帳列：數字對不齊 = 有漏單，紅字擺在最上面 */}
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${
          mismatch ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-600"
        }`}
      >
        <span>名單人數（不含工作人員）<strong>{reconcile.signupCount}</strong></span>
        <span>認列訂單 <strong>{reconcile.orderCount}</strong> 筆</span>
        <span>席次合計 <strong>{reconcile.seatCount}</strong></span>
        {mismatch && (
          <span className="font-medium">
            ⚠️ 名單人數與席次不一致——可能有訂單金額未匯入（可用下方補匯）或名單有手動加的人
          </span>
        )}
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {result.warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </div>
      )}
      {flash && <Feedback state={flash} />}

      {/* ── 一、收入明細 ── */}
      <section>
        <h2 className="mb-2 rounded-lg bg-[#4472C4] px-3 py-1.5 font-bold text-white">
          ▌ 一、收入明細
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#DCE6F1] text-left">
              <th className="px-2 py-1.5">項目</th>
              <th className="px-2 py-1.5 text-right">每人單價</th>
              <th className="px-2 py-1.5 text-right">數量（筆）</th>
              <th className="px-2 py-1.5 text-right">金額（元）</th>
              <th className="px-2 py-1.5">名單</th>
            </tr>
          </thead>
          <tbody>
            {result.incomeRows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-[#F2F7FF]" : ""}>
                <td className="px-2 py-1.5">
                  {r.label}
                  {r.hasOnsite && (
                    <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">
                      含現場
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{formatNT(r.unitPrice)}</td>
                <td className="px-2 py-1.5 text-right">{r.quantity}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatNT(r.amount)}</td>
                <td className="max-w-52 truncate px-2 py-1.5 text-xs text-gray-500" title={r.names.join("、")}>
                  {r.names.join("、")}
                </td>
              </tr>
            ))}
            <tr className="bg-[#E8F4FD] font-bold">
              <td className="px-2 py-1.5">收入合計</td>
              <td />
              <td className="px-2 py-1.5 text-right">
                {result.incomeRows.reduce((n, r) => n + r.quantity, 0)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{formatNT(result.totalIncome)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <ManualIncomeList
          orders={orders.filter((o) => o.source !== "IMPORT")}
          run={run}
          pending={pending}
        />
        <AddIncomeForm sessionId={sessionId} />
      </section>

      {/* ── 訂單明細（收入的原始資料；認列調整在這裡） ── */}
      <OrderDetail orders={orders} run={run} pending={pending} />

      {/* ── 二、支出明細 ── */}
      <section>
        <h2 className="mb-2 rounded-lg bg-[#4472C4] px-3 py-1.5 font-bold text-white">
          ▌ 二、支出明細
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#DCE6F1] text-left">
              <th className="px-2 py-1.5">費用項目</th>
              <th className="px-2 py-1.5">計算基礎</th>
              <th className="px-2 py-1.5 text-right">金額（元）</th>
              <th className="w-24 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {result.costRows.map((c, i) => (
              <tr key={c.id ?? `auto-${i}`} className={c.isAuto ? "" : "bg-[#FFF3CD]"}>
                <td className="px-2 py-1.5">
                  {c.label}
                  {c.kind === "EXTERNAL_SHARE" && (
                    <span className="ml-1 rounded bg-purple-100 px-1 text-xs text-purple-800">
                      外部分潤
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-500">{c.basisText ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatNT(c.amount)}</td>
                <td className="px-2 py-1.5 text-right">
                  {c.isAuto ? (
                    <span className="text-xs text-gray-400" title="依費率設定自動計算">
                      自動
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`刪除支出「${c.label}」？`))
                          run(() => deleteCostAction(c.id!));
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      刪除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-[#E8F4FD] font-bold">
              <td className="px-2 py-1.5">支出合計</td>
              <td />
              <td className="px-2 py-1.5 text-right font-mono">{formatNT(result.totalCost)}</td>
              <td />
            </tr>
            <tr className="bg-[#DEEAF1] font-bold text-[#1F4E79]">
              <td className="px-2 py-1.5">毛利（收入 － 支出）</td>
              <td />
              <td className={`px-2 py-1.5 text-right font-mono ${result.grossProfit < 0 ? "text-red-600" : ""}`}>
                {formatNT(result.grossProfit)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>

        <AddCostForms sessionId={sessionId} />
      </section>

      {/* ── 三、分潤計算 ── */}
      <SharesSection
        sessionId={sessionId}
        result={result}
        initialShares={initialShares}
        sharesSaved={sharesSaved}
        run={run}
        pending={pending}
      />
    </div>
  );
}

/** 訂單明細：認列金額、新生/複訓分類、整張排除。摺疊——日常只看三段表 */
function OrderDetail({
  orders,
  run,
  pending,
}: {
  orders: OrderRow[];
  run: (fn: () => Promise<FinanceFormState>) => void;
  pending: boolean;
}) {
  if (orders.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-400">
        尚無訂單金額資料——上傳訂單檔（場次看板的匯入，或本頁下方的金額補匯）後自動帶入。
      </p>
    );
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-gray-600">
        訂單明細（{orders.length} 筆）——調整認列金額、新生/複訓分類、排除訂單
      </summary>
      <div className="space-y-2 border-t border-gray-100 px-3 py-3">
        {orders.map((o) => (
          <div
            key={o.id}
            className={`rounded-lg border px-3 py-2 text-sm ${
              o.refundedAt
                ? "border-red-200 bg-red-50/60"
                : o.isRecognized
                  ? "border-gray-200"
                  : "border-gray-200 bg-gray-100 opacity-70"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-gray-400">{o.orderNo}</span>
              <span className="font-medium">{o.buyerName}</span>
              <span className="text-xs text-gray-500">
                {METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
                {o.paymentMethodRaw && o.paymentMethodRaw !== METHOD_LABEL[o.paymentMethod]
                  ? `（${o.paymentMethodRaw}）`
                  : ""}
              </span>
              {o.source !== "IMPORT" && (
                <span className="rounded bg-emerald-100 px-1 text-xs text-emerald-800">
                  {o.source === "ONSITE" ? "現場" : "手動"}
                </span>
              )}
              {o.manualOverride && (
                <span className="rounded bg-amber-100 px-1 text-xs text-amber-800" title="已人工調整；重匯不會覆蓋">
                  人工調整
                </span>
              )}
              {(() => {
                // 外部分潤歸屬（推薦人優先；內部/外部由 compute 層依設定判斷）
                const promoter = extractPromoter(o.salesPage);
                if (o.referrer)
                  return (
                    <span className="rounded bg-purple-100 px-1 text-xs text-purple-800" title={`推薦人：${o.referrer}${promoter ? `（銷售頁主：${promoter}）` : ""}`}>
                      推薦：{o.referrer}
                    </span>
                  );
                if (promoter)
                  return (
                    <span className="rounded bg-purple-50 px-1 text-xs text-purple-700" title={o.salesPage ?? ""}>
                      頁主：{promoter}
                    </span>
                  );
                return null;
              })()}
              {o.refundedAt && (
                <span className="rounded bg-red-100 px-1 text-xs text-red-700">
                  已退款 {formatNT(o.refundAmount)}
                </span>
              )}
              {!o.isRecognized && !o.refundedAt && (
                <span className="rounded bg-gray-200 px-1 text-xs text-gray-600">
                  不認列{o.excludeReason ? `：${o.excludeReason}` : ""}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                {!o.refundedAt && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (o.isRecognized) {
                        const reason = prompt("排除認列的原因（例：分期未繳完，暫不分潤）：");
                        if (reason === null) return;
                        run(() => setOrderRecognizedAction(o.id, false, reason));
                      } else {
                        run(() => setOrderRecognizedAction(o.id, true, ""));
                      }
                    }}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    {o.isRecognized ? "排除認列" : "恢復認列"}
                  </button>
                )}
                {o.source !== "IMPORT" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`刪除手動收入「${o.buyerName}」？`))
                        run(() => deleteManualOrderAction(o.id));
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    刪除
                  </button>
                )}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              {o.lines.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 pl-2 text-xs">
                  <span className="max-w-72 truncate text-gray-500" title={l.productRaw}>
                    {l.planLabel}
                  </span>
                  <span className="font-mono">
                    {formatNT(l.unitPrice)}×{l.quantity}
                  </span>
                  {/* 新生/複訓：自動判定可逐列覆寫（訂單買錯方案、代訂） */}
                  <select
                    value={l.studentType ?? "AUTO"}
                    disabled={pending}
                    onChange={(e) => run(() => setLineStudentTypeAction(l.id, e.target.value))}
                    className="rounded border border-gray-300 bg-white px-1 py-0.5"
                    title="收入明細的新生/複訓分類；「自動」依產品名判斷"
                  >
                    <option value="AUTO">
                      自動（{l.productRaw.includes("複訓") ? "複訓" : "新生"}）
                    </option>
                    <option value="NEW">新生</option>
                    <option value="RETRAIN">複訓</option>
                  </select>
                  <label className="flex items-center gap-1">
                    <span className="text-gray-400">認列</span>
                    <input
                      key={`${l.id}-${l.recognizedAmount}`}
                      defaultValue={l.recognizedAmount}
                      inputMode="numeric"
                      disabled={pending}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (Number(v) === l.recognizedAmount) return;
                        const note =
                          Number(v) !== l.amount
                            ? (prompt(
                                "認列說明（會進收支表底部的例外說明，例：組合方案僅認列本場部分）：",
                                l.recognizeNote ?? "",
                              ) ?? "")
                            : "";
                        run(() => setLineRecognitionAction(l.id, v, note));
                      }}
                      className={`w-20 rounded border px-1 py-0.5 text-right font-mono ${
                        l.recognizedAmount !== l.amount
                          ? "border-amber-400 bg-amber-50"
                          : "border-gray-300"
                      }`}
                      title={`付款金額 ${formatNT(l.amount)}；認列金額可下修（組合方案只認列本場那一段）`}
                    />
                  </label>
                  {l.recognizedAmount !== l.amount && (
                    <span className="text-amber-700" title={l.recognizeNote ?? ""}>
                      付款 {formatNT(l.amount)}，認列 {formatNT(l.recognizedAmount)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

/** 手動收入列表：每筆可直接編輯／刪除（1shop 匯入的訂單不在此，走訂單明細的認列調整） */
function ManualIncomeList({
  orders,
  run,
  pending,
}: {
  orders: OrderRow[];
  run: (fn: () => Promise<FinanceFormState>) => void;
  pending: boolean;
}) {
  if (orders.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/40">
      <p className="px-3 pt-2 text-xs font-medium text-emerald-800">
        手動新增的收入（{orders.length} 筆）——可直接修改後儲存，或刪除
      </p>
      <div className="space-y-1 px-3 py-2">
        {orders.map((o) => (
          <ManualIncomeRow key={o.id} order={o} run={run} pending={pending} />
        ))}
      </div>
    </div>
  );
}

function ManualIncomeRow({
  order: o,
  run,
  pending,
}: {
  order: OrderRow;
  run: (fn: () => Promise<FinanceFormState>) => void;
  pending: boolean;
}) {
  const line = o.lines[0];
  const [draft, setDraft] = useState({
    name: o.buyerName,
    unitPrice: line?.unitPrice ?? 0,
    quantity: line?.quantity ?? 1,
    paymentMethod: o.paymentMethod,
    studentType: line?.studentType ?? "NEW",
  });
  const saved = {
    name: o.buyerName,
    unitPrice: line?.unitPrice ?? 0,
    quantity: line?.quantity ?? 1,
    paymentMethod: o.paymentMethod,
    studentType: line?.studentType ?? "NEW",
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded bg-emerald-100 px-1 text-xs text-emerald-800">
        {o.source === "ONSITE" ? "現場" : "手動"}
      </span>
      <input
        value={draft.name}
        disabled={pending}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        className="w-32 rounded border border-gray-300 px-2 py-1"
        title="姓名／名目"
      />
      <label className="flex items-center gap-1">
        <span className="text-xs text-gray-400">單價</span>
        <input
          value={draft.unitPrice}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) || 0 })}
          className="w-20 rounded border border-gray-300 px-2 py-1 text-right font-mono"
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-xs text-gray-400">×</span>
        <input
          value={draft.quantity}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) || 1 })}
          className="w-12 rounded border border-gray-300 px-2 py-1 text-right"
          title="數量"
        />
      </label>
      <select
        value={draft.studentType}
        disabled={pending}
        onChange={(e) => setDraft({ ...draft, studentType: e.target.value })}
        className="rounded border border-gray-300 bg-white px-1 py-1"
      >
        <option value="NEW">新生</option>
        <option value="RETRAIN">複訓</option>
      </select>
      <select
        value={draft.paymentMethod}
        disabled={pending}
        onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}
        className="rounded border border-gray-300 bg-white px-1 py-1"
      >
        {["CASH", "CREDIT_ONE", "CREDIT_INSTALLMENT", "ATM", "OTHER"].map((m) => (
          <option key={m} value={m}>
            {METHOD_LABEL[m]}
          </option>
        ))}
      </select>
      <span className="font-mono text-xs text-gray-500">
        ＝{formatNT(draft.unitPrice * draft.quantity)}
      </span>
      <button
        type="button"
        disabled={pending || !dirty}
        onClick={() => run(() => updateManualIncomeAction(o.id, draft))}
        className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
      >
        儲存
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`刪除手動收入「${o.buyerName}」？`))
            run(() => deleteManualOrderAction(o.id));
        }}
        className="text-xs text-red-500 hover:underline"
      >
        刪除
      </button>
    </div>
  );
}

/** 手動新增收入（現場收現金等） */
function AddIncomeForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<FinanceFormState, FormData>(
    addManualIncomeAction.bind(null, sessionId),
    null,
  );
  return (
    <details className="mt-2 rounded-lg border border-dashed border-gray-300">
      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500">
        ＋ 手動新增收入（現場收現金、無訂單編號的款項）
      </summary>
      <form action={action} className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-3 py-2 text-sm">
        <input name="name" required placeholder="姓名／名目" className="w-36 rounded-lg border border-gray-300 px-2 py-1.5" />
        <input name="unitPrice" required inputMode="numeric" placeholder="單價" className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
        <input name="quantity" defaultValue={1} inputMode="numeric" className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right" title="數量" />
        <select name="studentType" className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
          <option value="NEW">新生</option>
          <option value="RETRAIN">複訓</option>
        </select>
        <select name="paymentMethod" defaultValue="CASH" className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
          <option value="CASH">現場付款</option>
          <option value="CREDIT_ONE">信用卡單筆</option>
          <option value="CREDIT_INSTALLMENT">信用卡分期</option>
          <option value="ATM">ATM匯款</option>
          <option value="OTHER">其他</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" name="isOnsite" defaultChecked />
          現場收款
        </label>
        <input name="note" placeholder="備註（選填）" className="w-40 rounded-lg border border-gray-300 px-2 py-1.5" />
        <SubmitButton pendingText="新增中…">新增收入</SubmitButton>
        {pending && <span className="text-xs text-gray-400">處理中…</span>}
        <Feedback state={state} />
      </form>
    </details>
  );
}

/** 新增支出：固定型手填＋外部分潤（毛收×%）兩個表單 */
function AddCostForms({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState<FinanceFormState, FormData>(
    addCostAction.bind(null, sessionId),
    null,
  );
  const [kind, setKind] = useState<"FIXED" | "EXTERNAL_SHARE">("FIXED");
  return (
    <details className="mt-2 rounded-lg border border-dashed border-gray-300" open>
      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500">
        ＋ 新增支出（場地費、餐費、講義印刷、交通車馬、雜支…）或外部分潤（講師抽成）
      </summary>
      <form action={action} className="space-y-2 border-t border-gray-100 px-3 py-2 text-sm">
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1">
            <input type="radio" name="kind" value="FIXED" checked={kind === "FIXED"} onChange={() => setKind("FIXED")} />
            一般支出（手填金額）
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="kind" value="EXTERNAL_SHARE" checked={kind === "EXTERNAL_SHARE"} onChange={() => setKind("EXTERNAL_SHARE")} />
            外部分潤（毛收 × %，列為支出先扣）
          </label>
        </div>
        {kind === "FIXED" ? (
          <div className="flex flex-wrap items-end gap-2">
            <input name="label" required placeholder="費用項目（場地費／餐費（便當）／講義印刷費…）" list="cost-suggestions" className="w-64 rounded-lg border border-gray-300 px-2 py-1.5" />
            <datalist id="cost-suggestions">
              {["場地費", "餐費（便當）", "講義印刷費", "交通車馬費", "廣告費", "講師費", "雜支", "其他"].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <input name="amount" required inputMode="numeric" placeholder="金額（元）" className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
            <input name="basisText" placeholder="計算基礎（選填，例：65 份 × $250）" className="w-56 rounded-lg border border-gray-300 px-2 py-1.5" />
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <input name="payee" required placeholder="分潤對象（講師姓名）" className="w-36 rounded-lg border border-gray-300 px-2 py-1.5" />
            <input name="label" required placeholder="項目名（例：講師抽成-黃OO）" className="w-52 rounded-lg border border-gray-300 px-2 py-1.5" />
            <input name="basisAmount" required inputMode="numeric" placeholder="基準金額（該課程毛收）" className="w-44 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
            <label className="flex items-center gap-1">
              <input name="ratePct" required inputMode="decimal" placeholder="10" className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
              %
            </label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <SubmitButton pendingText="新增中…">新增</SubmitButton>
          {pending && <span className="text-xs text-gray-400">處理中…</span>}
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}

/** 外部分潤（毛收 × %，列為支出先扣）：第三段直接呈現與新增，
 *  金額仍計入「二、支出明細」——只是入口與總覽放在分潤段，不用去支出區翻 */
function ExternalShareBlock({
  sessionId,
  result,
  run,
  pending,
}: {
  sessionId: string;
  result: FinanceResult;
  run: (fn: () => Promise<FinanceFormState>) => void;
  pending: boolean;
}) {
  const [state, action, formPending] = useActionState<FinanceFormState, FormData>(
    addCostAction.bind(null, sessionId),
    null,
  );
  const rows = result.costRows.filter((c) => c.kind === "EXTERNAL_SHARE");
  return (
    <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50/40">
      <p className="px-3 pt-2 text-sm font-medium text-purple-900">
        外部分潤（講師／天使長抽成）——列為支出先扣，不參與下方內部比例分配
      </p>
      <p className="px-3 text-xs text-purple-800/70">
        標「自動」的列＝依訂單的推薦人／銷售頁「推廣者-XXX專用」自動歸屬，
        基數只算該人的<strong>新生</strong>認列金額；要改費率或金額，用下方表單加同名人工列即可覆寫
      </p>
      {rows.length > 0 ? (
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-purple-800/70">
              <th className="px-3 py-1">對象／項目</th>
              <th className="px-2 py-1">計算基礎</th>
              <th className="px-2 py-1 text-right">金額（元）</th>
              <th className="w-16 px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id ?? `auto-ext-${i}`} className="border-t border-purple-100">
                <td className="px-3 py-1.5">
                  {c.label}
                  {c.isAuto && (
                    <span
                      className="ml-1 rounded bg-purple-100 px-1 text-xs text-purple-700"
                      title="依訂單的推薦人／銷售頁推廣者自動計算；用下方表單加同名人工列即可覆寫金額或費率"
                    >
                      自動
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-500">{c.basisText ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatNT(c.amount)}</td>
                <td className="px-2 py-1.5 text-right">
                  {c.isAuto ? (
                    <span className="text-xs text-gray-400" title="同名人工列可覆寫">
                      自動
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`刪除外部分潤「${c.label}」？`))
                          run(() => deleteCostAction(c.id!));
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      刪除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-purple-200 font-bold">
              <td className="px-3 py-1.5">外部分潤合計（已含在支出合計）</td>
              <td />
              <td className="px-2 py-1.5 text-right font-mono">
                {formatNT(rows.reduce((n, c) => n + c.amount, 0))}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="px-3 py-1 text-xs text-gray-500">
          本場沒有自動歸屬到的外部分潤（訂單無推薦人／推廣者頁，或都是內部人員）——
          要手動加的在下面：
        </p>
      )}
      <form action={action} className="flex flex-wrap items-end gap-2 border-t border-purple-100 px-3 py-2 text-sm">
        <input type="hidden" name="kind" value="EXTERNAL_SHARE" />
        <input name="payee" required placeholder="對象姓名（講師／天使長）" className="w-44 rounded-lg border border-gray-300 px-2 py-1.5" />
        <input name="basisAmount" required inputMode="numeric" placeholder="基準金額（該課程毛收）" className="w-44 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
        <label className="flex items-center gap-1">
          <input name="ratePct" required inputMode="decimal" placeholder="20" className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-right" />
          %
        </label>
        <SubmitButton
          pendingText="新增中…"
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          ＋ 新增外部分潤
        </SubmitButton>
        {formPending && <span className="text-xs text-gray-400">處理中…</span>}
        <Feedback state={state} />
      </form>
    </div>
  );
}

/** 三、分潤計算：比例可調（本場覆寫），即時看到金額 */
function SharesSection({
  sessionId,
  result,
  initialShares,
  sharesSaved,
  run,
  pending: parentPending,
}: {
  sessionId: string;
  result: FinanceResult;
  initialShares: { name: string; pct: number }[];
  sharesSaved: boolean;
  run: (fn: () => Promise<FinanceFormState>) => void;
  pending: boolean;
}) {
  const [rows, setRows] = useState(initialShares);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<FinanceFormState>(null);
  const totalPct = rows.reduce((n, r) => n + (Number.isFinite(r.pct) ? r.pct : 0), 0);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initialShares);

  return (
    <section>
      <h2 className="mb-2 rounded-lg bg-[#4472C4] px-3 py-1.5 font-bold text-white">
        ▌ 三、分潤計算
      </h2>
      <ExternalShareBlock
        sessionId={sessionId}
        result={result}
        run={run}
        pending={parentPending}
      />
      <p className="mb-1 text-sm font-medium text-gray-700">
        內部分潤（毛利 × 比例）
        {!sharesSaved && (
          <span className="ml-2 text-xs font-normal text-gray-400">
            目前套用全域預設，儲存後固定為本場設定
          </span>
        )}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#DCE6F1] text-left">
            <th className="px-2 py-1.5">分潤對象</th>
            <th className="px-2 py-1.5">計算基礎</th>
            <th className="w-28 px-2 py-1.5 text-right">比例（%）</th>
            <th className="px-2 py-1.5 text-right">分潤金額</th>
            <th className="w-16 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const live = result.shareRows.find((s) => s.payeeName === r.name);
            // 編輯中即時試算（未儲存）：毛利 × 輸入比例
            const amount = dirty
              ? Math.sign(result.grossProfit * r.pct) *
                Math.round(Math.abs((result.grossProfit * r.pct) / 100))
              : (live?.amount ?? 0);
            return (
              <tr key={i} className="bg-[#FFF3CD]">
                <td className="px-2 py-1.5">
                  <input
                    value={r.name}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    className="w-32 rounded border border-amber-300 bg-white px-2 py-1"
                  />
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-500">毛利 × {r.pct}%</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    value={r.pct}
                    inputMode="decimal"
                    onChange={(e) =>
                      setRows(
                        rows.map((x, j) =>
                          j === i ? { ...x, pct: Number(e.target.value) || 0 } : x,
                        ),
                      )
                    }
                    className="w-20 rounded border border-amber-300 bg-white px-2 py-1 text-right"
                  />
                </td>
                <td className={`px-2 py-1.5 text-right font-mono ${amount < 0 ? "text-red-600" : ""}`}>
                  {formatNT(amount)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="text-xs text-red-500 hover:underline"
                  >
                    移除
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="bg-[#E8F4FD] font-bold">
            <td className="px-2 py-1.5">合計</td>
            <td />
            <td className={`px-2 py-1.5 text-right ${Math.abs(totalPct - 100) > 0.01 ? "text-amber-700" : ""}`}>
              {totalPct}%
            </td>
            <td className="px-2 py-1.5 text-right font-mono">
              {formatNT(dirty ? result.grossProfit : result.totalShared)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows([...rows, { name: "", pct: 0 }])}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ＋ 加一位
        </button>
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () =>
              setFlash(await saveSharesAction(sessionId, JSON.stringify(rows))),
            )
          }
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "儲存中…" : "儲存分潤比例"}
        </button>
        {Math.abs(totalPct - 100) > 0.01 && (
          <span className="text-xs text-amber-700">
            比例合計 {totalPct}%——可以刻意不等於 100%（例：保留給公司），確認即可
          </span>
        )}
        <Feedback state={flash} />
      </div>
    </section>
  );
}
