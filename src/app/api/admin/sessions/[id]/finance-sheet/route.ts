import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { getFinanceSettings } from "@/lib/finance/settings";
import {
  computeSessionFinance,
  type FinanceOrderInput,
  type ManualCostInput,
} from "@/lib/finance/compute";
import { buildFinanceWorkbook } from "@/lib/finance/sheet";

// 場次收支表下載：權限＋撈資料在這裡，版面建構在 lib/finance/sheet.ts（測試共用）。
// 用 requireEditor（throw → 403）而非 pageGuard——下載連結吃 3xx 會存到錯誤內容。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireEditor();
  } catch {
    return new Response("需要編輯權限", { status: 403 });
  }
  const { id } = await params;

  const [session, orders, storedCosts, storedShares, settings, signupCount] =
    await Promise.all([
      prisma.courseSession.findUnique({
        where: { id },
        select: { id: true, title: true, finance: true },
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
  if (!session) return new Response("場次不存在", { status: 404 });

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
  const result = computeSessionFinance({ orders: orderInputs, manualCosts, shares, settings });

  const wb = buildFinanceWorkbook({
    title: session.title,
    signupCount,
    todayText: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date()),
    result,
    sharesPpmTotal: shares.reduce((n, s) => n + s.sharePpm, 0),
    orders: orders.map((o) => ({
      orderNo: o.orderNo,
      buyerName: o.buyerName,
      isRecognized: o.isRecognized,
      excludeReason: o.excludeReason,
      refundedAt: o.refundedAt,
      refundAmount: o.refundAmount,
      lines: o.lines.map((l) => ({
        amount: l.amount,
        recognizedAmount: l.recognizedAmount,
        recognizeNote: l.recognizeNote,
      })),
    })),
    sourceFile: session.finance?.sourceFile,
    sourceNote: session.finance?.sourceNote,
  });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `${session.title}-收支表.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // ASCII fallback + RFC 5987 中文檔名（同 signin-sheet 慣例）
      "Content-Disposition": `attachment; filename="finance-sheet.xlsx"; filename*=UTF-8\'\'${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
