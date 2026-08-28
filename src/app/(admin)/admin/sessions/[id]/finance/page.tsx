import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { getFinanceSettings } from "@/lib/finance/settings";
import {
  computeSessionFinance,
  type FinanceOrderInput,
  type ManualCostInput,
} from "@/lib/finance/compute";
import { FinanceManager } from "./finance-manager";

export const metadata = { title: "場次收支 — 管理後台" };
export const dynamic = "force-dynamic";

// 單場收支結算：三段結構（收入／支出／分潤）與他的 Excel 收支表 1:1。
// 分潤金額是內部薪酬——頁面走 pageGuardEditor，總教練（coach）進不來。
export default async function SessionFinancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await pageGuardEditor();
  const { id } = await params;

  const [session, orders, storedCosts, storedShares, settings, signupStats] =
    await Promise.all([
      prisma.courseSession.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          eventDate: true,
          finance: true,
        },
      }),
      prisma.sessionOrder.findMany({
        where: { sessionId: id },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
        orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
      }),
      prisma.sessionCost.findMany({
        where: { sessionId: id, isAuto: false },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.sessionProfitShare.findMany({
        where: { sessionId: id },
        orderBy: { sortOrder: "asc" },
      }),
      getFinanceSettings(),
      prisma.sessionSignup.count({
        where: { sessionId: id, deferredToSessionId: null, isStaff: false },
      }),
    ]);
  if (!session) notFound();

  // 尚未替本場設定分潤 → 用全域預設（顯示用；按「儲存分潤比例」才落地）
  const shares =
    storedShares.length > 0
      ? storedShares.map((s) => ({ payeeName: s.payeeName, sharePpm: s.sharePpm }))
      : settings.internalShares.map((s) => ({ payeeName: s.name, sharePpm: s.ppm }));

  const orderInputs: FinanceOrderInput[] = orders.map((o) => ({
    id: o.id,
    paymentMethod: o.paymentMethod,
    isRecognized: o.isRecognized,
    refundedAt: o.refundedAt,
    buyerName: o.buyerName,
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
  const manualCosts: ManualCostInput[] = storedCosts.map((c) => ({
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

  const result = computeSessionFinance({
    orders: orderInputs,
    manualCosts,
    shares,
    settings,
  });

  // 日常對帳列：四個數字對不齊就是有漏單（比任何測試都常用）
  const recognizedSeats = orders
    .filter((o) => o.isRecognized && !o.refundedAt)
    .reduce((n, o) => n + o.lines.reduce((m, l) => m + l.quantity, 0), 0);

  return (
    <div className="max-w-4xl">
      <Link href="/admin/sessions" className="text-sm text-indigo-600 hover:underline">
        ← 回場次看板
      </Link>
      <div className="mb-1 mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{session.title}　收支結算</h1>
        <a
          href={`/api/admin/sessions/${session.id}/finance-sheet`}
          download
          className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm transition hover:bg-gray-100"
        >
          ⬇︎ 匯出收支表（Excel，合計與分潤帶公式）
        </a>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        收入來自訂單匯入自動彙總（新生／複訓 × 付款方式）；稅費與手續費依
        <Link href="/admin/sessions/finance/settings" className="mx-1 text-indigo-600 underline">
          費率設定
        </Link>
        自動計算；黃底列＝人工填入。
      </p>

      <FinanceManager
        sessionId={session.id}
        sharesSaved={storedShares.length > 0}
        result={result}
        reconcile={{
          signupCount: signupStats,
          orderCount: orders.filter((o) => o.isRecognized && !o.refundedAt).length,
          seatCount: recognizedSeats,
        }}
        orders={orders.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          source: o.source,
          buyerName: o.buyerName,
          paymentMethod: o.paymentMethod,
          paymentMethodRaw: o.paymentMethodRaw,
          isRecognized: o.isRecognized,
          excludeReason: o.excludeReason,
          refundedAt: o.refundedAt?.toISOString() ?? null,
          refundAmount: o.refundAmount,
          manualOverride: o.manualOverride,
          lines: o.lines.map((l) => ({
            id: l.id,
            productRaw: l.productRaw,
            planLabel: l.planLabel,
            studentType: l.studentType,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            amount: l.amount,
            recognizedAmount: l.recognizedAmount,
            recognizeNote: l.recognizeNote,
            isOnsite: l.isOnsite,
          })),
        }))}
        shares={shares.map((s) => ({ name: s.payeeName, pct: s.sharePpm / 10_000 }))}
      />
    </div>
  );
}
