import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";
import { OrderTools } from "./order-tools";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  await requireStaff();
  const { orderNo } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: {
      items: { include: { course: { select: { title: true, slug: true } } } },
      payment: true,
    },
  });
  if (!order) notFound();

  const [invoice, enrollmentCount] = await Promise.all([
    prisma.invoiceRecord.findUnique({ where: { orderId: order.id } }),
    prisma.enrollment.count({ where: { orderId: order.id } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/orders" className="text-sm text-gray-500 hover:underline">
          ← 回訂單列表
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-bold">{order.orderNo}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${ORDER_STATUS_COLOR[order.status]}`}
          >
            {ORDER_STATUS_LABEL[order.status]}
          </span>
        </div>
      </div>

      {/* ── 訂單資訊 ── */}
      <section className="rounded-2xl border border-gray-200 p-5">
        <h2 className="mb-3 text-base font-bold">訂單資訊</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="訂購人" value={order.buyerName ?? "—"} />
          <Row label="電話" value={order.buyerPhone ?? "—"} />
          <Row label="Email" value={order.buyerEmail ?? "—"} />
          <Row label="訂單金額" value={formatNT(order.total)} />
          <Row
            label="明細"
            value={`小計 ${formatNT(order.subtotal)}｜折扣 ${formatNT(order.discount)}`}
          />
          <Row label="下單時間" value={formatDate(order.createdAt)} />
          <Row label="付款時間" value={order.paidAt ? formatDate(order.paidAt) : "—"} />
          <Row
            label="課程開通"
            value={
              enrollmentCount > 0
                ? `已開通 ${enrollmentCount} 門`
                : order.status === "PAID"
                  ? "⚠️ 已付款但未開通"
                  : "未開通"
            }
          />
        </dl>
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm">
          {order.items.map((it) => (
            <div key={it.id} className="flex justify-between py-1">
              <span>{it.course.title}</span>
              <span className="text-gray-500">{formatNT(it.unitPrice)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 金流資訊 ── */}
      <section className="rounded-2xl border border-gray-200 p-5">
        <h2 className="mb-3 text-base font-bold">金流資訊</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="金流商" value={order.payment?.provider ?? "—"} />
          <Row label="付款方式" value={order.payment?.paymentType ?? "—"} />
          <Row label="交易序號" value={order.payment?.tradeNo ?? "—"} mono />
          <Row
            label="通知時間"
            value={order.payment?.notifiedAt ? formatDate(order.payment.notifiedAt) : "—"}
          />
        </dl>
      </section>

      {/* ── 發票資訊 ── */}
      <section className="rounded-2xl border border-gray-200 p-5">
        <h2 className="mb-3 text-base font-bold">電子發票</h2>
        {invoice ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row
              label="狀態"
              value={
                invoice.status === "ISSUED"
                  ? "✅ 已開立"
                  : invoice.status === "FAILED"
                    ? "❌ 開立失敗"
                    : "⏳ 開立中"
              }
            />
            <Row label="發票號碼" value={invoice.invoiceNumber ?? "—"} mono />
            <Row label="隨機碼" value={invoice.randomNum ?? "—"} mono />
            <Row
              label="開立時間"
              value={invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}
            />
            {invoice.error && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">失敗原因</dt>
                <dd className="mt-0.5 rounded-lg bg-red-50 px-3 py-2 text-red-700">
                  {invoice.error}（已嘗試 {invoice.attempts} 次）
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-gray-500">
            {order.status === "PAID" && order.total > 0
              ? "尚未開立（可用下方按鈕補開）"
              : "此訂單不需開立發票"}
          </p>
        )}
        <p className="mt-3 text-xs text-gray-400">
          作廢與折讓請至 ezPay 後台操作（奇數月 14 日前可作廢前兩個月的發票）。
        </p>
      </section>

      {/* ── 操作 ── */}
      <OrderTools
        orderNo={order.orderNo}
        orderStatus={order.status}
        invoiceStatus={invoice?.status ?? null}
        total={order.total}
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-gray-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
