import Link from "next/link";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { getFinanceSettings } from "@/lib/finance/settings";
import {
  computeSessionFinance,
  type FinanceOrderInput,
  type ManualCostInput,
} from "@/lib/finance/compute";
import {
  FINANCE_TEMPLATE_LABEL,
  deriveFinanceTemplate,
  type FinanceTemplate,
} from "@/lib/finance/labels";
import { formatNT, formatDate } from "@/lib/format";
import { FinanceUploadForm } from "./finance-upload";

export const metadata = { title: "收支結算 — 管理後台" };
export const dynamic = "force-dynamic";

// 收支結算總覽：有金額資料的場次一覽（收入/支出/毛利/狀態），點入單場結算。
// 僅管理員（分潤金額是內部薪酬）；獨立於場次看板類別（2026-08-29 Jason 指示）。
export default async function FinanceOverviewPage() {
  await pageGuardFullAdmin();

  const [sessions, settings] = await Promise.all([
    prisma.courseSession.findMany({
      where: { finanOrders: { some: {} } },
      orderBy: [{ eventDate: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        eventDate: true,
        financeTemplate: true,
        finance: { select: { status: true } },
        finanOrders: {
          include: { lines: { orderBy: { sortOrder: "asc" } } },
          orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
        },
        finanCosts: { where: { isAuto: false }, orderBy: { sortOrder: "asc" } },
        finanShares: { orderBy: { sortOrder: "asc" } },
      },
      take: 100,
    }),
    getFinanceSettings(),
  ]);

  const rows = sessions.map((s) => {
    const template: FinanceTemplate =
      (s.financeTemplate as FinanceTemplate | null) ?? deriveFinanceTemplate(s.title);
    const orders: FinanceOrderInput[] = s.finanOrders.map((o) => ({
      id: o.id,
      paymentMethod: o.paymentMethod,
      isRecognized: o.isRecognized,
      refundedAt: o.refundedAt,
      buyerName: o.buyerName,
      salesPage: o.salesPage,
      referrer: o.referrer,
      lines: o.lines.map((l) => ({
        planLabel: l.planLabel,
        productRaw: l.productRaw,
        studentType: l.studentType,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        recognizedAmount: l.recognizedAmount,
        isOnsite: l.isOnsite,
      })),
    }));
    const manualCosts: ManualCostInput[] = s.finanCosts.map((c) => ({
      id: c.id,
      kind: c.kind,
      code: c.code,
      label: c.label,
      basisText: c.basisText,
      basisAmount: c.basisAmount,
      ratePpm: c.ratePpm,
      unitAmount: c.unitAmount,
      unitCount: c.unitCount,
      amount: c.amount,
      payee: c.payee,
      sortOrder: c.sortOrder,
    }));
    const shares =
      s.finanShares.length > 0
        ? s.finanShares.map((x) => ({ payeeName: x.payeeName, sharePpm: x.sharePpm }))
        : settings.internalShares.map((x) => ({ payeeName: x.name, sharePpm: x.ppm }));
    const r = computeSessionFinance({ orders, manualCosts, shares, settings, template });
    return {
      id: s.id,
      title: s.title,
      eventDate: s.eventDate?.toISOString() ?? null,
      template,
      locked: s.finance?.status === "LOCKED",
      orderCount: s.finanOrders.filter((o) => o.isRecognized && !o.refundedAt).length,
      totalIncome: r.totalIncome,
      totalCost: r.totalCost,
      grossProfit: r.grossProfit,
      warnings: r.warnings.length,
    };
  });

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);

  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">收支結算</h1>
        <Link
          href="/admin/finance/settings"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
        >
          ⚙️ 費率與分潤設定
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        各場次的收入／支出／毛利一覽（依當前費率即時計算；已結算場次讀快照狀態）。
        點場次名稱進入單場結算表。
      </p>

      {rows.length === 0 ? (
        <p className="mb-6 rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400">
          還沒有任何場次的金額資料——在場次看板上傳訂單檔，或用下方「金額補匯」上傳歷史訂單檔。
        </p>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">場次</th>
                <th className="px-2 py-2">日期</th>
                <th className="px-2 py-2">模板</th>
                <th className="px-2 py-2 text-right">訂單</th>
                <th className="px-2 py-2 text-right">收入</th>
                <th className="px-2 py-2 text-right">支出</th>
                <th className="px-2 py-2 text-right">毛利</th>
                <th className="px-2 py-2">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/finance/${r.id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {r.title}
                    </Link>
                    {r.warnings > 0 && (
                      <span
                        className="ml-1 text-xs text-amber-600"
                        title="本場有警示（付款方式未知/比例不足…），進單場頁查看"
                      >
                        ⚠️{r.warnings}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-gray-500">
                    {r.eventDate ? formatDate(r.eventDate) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-gray-500">
                    {FINANCE_TEMPLATE_LABEL[r.template]}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-gray-500">{r.orderCount}</td>
                  <td className="px-2 py-2 text-right font-mono">{formatNT(r.totalIncome)}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-500">
                    {formatNT(r.totalCost)}
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-mono font-medium ${
                      r.grossProfit < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {formatNT(r.grossProfit)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    {r.locked ? (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-600">已結算</span>
                    ) : (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">編製中</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className="px-3 py-2">合計（{rows.length} 場）</td>
                <td />
                <td />
                <td className="px-2 py-2 text-right text-xs">{sum((r) => r.orderCount)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatNT(sum((r) => r.totalIncome))}</td>
                <td className="px-2 py-2 text-right font-mono">{formatNT(sum((r) => r.totalCost))}</td>
                <td className="px-2 py-2 text-right font-mono">{formatNT(sum((r) => r.grossProfit))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <FinanceUploadForm />
    </div>
  );
}
