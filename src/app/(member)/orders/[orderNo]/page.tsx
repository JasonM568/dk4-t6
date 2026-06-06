import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: { items: { include: { course: true } }, payment: true },
  });
  // 只能看自己的訂單
  if (!order || order.userId !== session.user.id) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/orders" className="text-sm text-gray-500 hover:text-black">
        ← 訂單管理
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">訂單明細</h1>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            ORDER_STATUS_COLOR[order.status]
          }`}
        >
          {ORDER_STATUS_LABEL[order.status]}
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 p-5">
        <Row label="訂單編號" value={order.orderNo} mono />
        <Row label="建立時間" value={formatDate(order.createdAt)} />
        {order.paidAt && (
          <Row label="付款時間" value={formatDate(order.paidAt)} />
        )}
        {order.payment?.paymentType && (
          <Row label="付款方式" value={order.payment.paymentType} />
        )}
        {order.payment?.tradeNo && (
          <Row label="金流交易序號" value={order.payment.tradeNo} mono />
        )}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 p-5">
        <h2 className="mb-3 font-bold">購買項目</h2>
        <ul className="space-y-2">
          {order.items.map((it) => (
            <li key={it.id} className="flex justify-between text-sm">
              <span>{it.course.title}</span>
              <span>{formatNT(it.unitPrice)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>小計</span>
            <span>{formatNT(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>會員折扣</span>
              <span>-{formatNT(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>實付金額</span>
            <span>{formatNT(order.total)}</span>
          </div>
        </div>
      </div>

      {order.status === "PAID" && (
        <Link
          href="/my-courses"
          className="mt-6 block w-full rounded-lg bg-green-600 py-3 text-center font-medium text-white transition hover:bg-green-700"
        >
          前往我的課程觀看 →
        </Link>
      )}
      {order.status === "PENDING" && (
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          此訂單尚未完成付款。若已付款，系統確認後會自動更新狀態。
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
