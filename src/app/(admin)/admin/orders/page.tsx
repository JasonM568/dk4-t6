import Link from "next/link";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";
import { SaveBuyersForm } from "./save-buyers-form";

export const metadata = { title: "訂單管理" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["ALL", "PENDING", "AWAITING_CONFIRM", "PAID", "CONFIRMED", "COMPLETED", "CANCELLED", "FAILED", "EXPIRED", "REFUNDED"] as const;

const INVOICE_BADGE: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "已開立", cls: "bg-green-100 text-green-700" },
  FAILED: { label: "開立失敗", cls: "bg-red-100 text-red-700" },
  PENDING: { label: "開立中", cls: "bg-amber-100 text-amber-700" },
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status = "ALL", q = "" } = await searchParams;
  const query = q.trim();

  const where: Prisma.OrderWhereInput = {
    ...(status !== "ALL" && STATUS_FILTERS.includes(status as (typeof STATUS_FILTERS)[number])
      ? { status: status as Prisma.OrderWhereInput["status"] }
      : {}),
    ...(query
      ? {
          OR: [
            { orderNo: { contains: query, mode: "insensitive" } },
            { buyerEmail: { contains: query, mode: "insensitive" } },
            { buyerName: { contains: query, mode: "insensitive" } },
            { buyerPhone: { contains: query } },
          ],
        }
      : {}),
  };

  const [orders, counts] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: { include: { course: { select: { title: true } } } },
        payment: { select: { provider: true, tradeNo: true, paymentType: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.order.groupBy({ by: ["status"], _count: true }),
  ]);

  // 發票狀態一次撈（避免 N+1）
  const invoices = await prisma.invoiceRecord.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, status: true, invoiceNumber: true },
  });
  const invoiceByOrder = new Map(invoices.map((i) => [i.orderId, i]));

  const countOf = (s: string) =>
    s === "ALL"
      ? counts.reduce((sum, c) => sum + c._count, 0)
      : (counts.find((c) => c.status === s)?._count ?? 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">訂單管理</h1>
        <SaveBuyersForm />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?status=${s}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              status === s ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s === "ALL" ? "全部" : ORDER_STATUS_LABEL[s]}（{countOf(s)}）
          </Link>
        ))}
        <form method="get" className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={query}
            placeholder="訂單編號/姓名/電話/Email"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
          />
          <button className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm hover:bg-gray-100">
            搜尋
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">訂單編號</th>
              <th className="px-4 py-3">訂購人</th>
              <th className="px-4 py-3">課程</th>
              <th className="px-4 py-3">金額</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">付款方式</th>
              <th className="px-4 py-3">發票</th>
              <th className="px-4 py-3">訂購時間</th>
              <th className="px-4 py-3">付款時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((o) => {
              const inv = invoiceByOrder.get(o.id);
              const badge = inv ? INVOICE_BADGE[inv.status] : null;
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/admin/orders/${o.orderNo}`}
                      className="text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {o.orderNo}
                    </Link>
                  </td>
                  {/* 訂購人快照（下單當下的姓名/電話/Email，1shop 樣式疊放） */}
                  <td className="px-4 py-3">
                    <div className="font-medium">{o.buyerName ?? "—"}</div>
                    {o.buyerPhone && (
                      <div className="text-xs text-gray-500">{o.buyerPhone}</div>
                    )}
                    <div className="text-xs text-gray-400">{o.buyerEmail ?? ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    {o.items.map((it) => it.course.title).join("、")}
                  </td>
                  <td className="px-4 py-3">{formatNT(o.total)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLOR[o.status]}`}
                    >
                      {ORDER_STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {o.payment?.paymentType ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {badge ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                        title={inv?.invoiceNumber ?? undefined}
                      >
                        {inv?.invoiceNumber ?? badge.label}
                      </span>
                    ) : ["PAID", "CONFIRMED", "COMPLETED"].includes(o.status) && o.total > 0 ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        未開立
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {o.paidAt ? formatDate(o.paidAt) : "—"}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                  沒有符合條件的訂單
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        最多顯示 200 筆；點訂單編號進入詳情可做金流確認、補開通與發票重開。
      </p>
    </div>
  );
}
