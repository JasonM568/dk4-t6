import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";
import { PendingRefresh } from "./pending-refresh";

// 付款導回後這頁就是「結帳完成頁」：狀態要即時，不能吃快取
export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: { items: { include: { course: true } }, payment: true },
  });
  // 只能看自己的訂單
  if (!order || order.userId !== user.id) notFound();

  // 付款後的三種落點：已付款 → 感謝區塊；待付款＋ATM 取號 → 繳費資訊；
  // 待付款（信用卡剛付完、通知還在路上）→ 確認中提示＋自動刷新
  const isPaid = ["PAID", "CONFIRMED", "COMPLETED"].includes(order.status);
  const raw = (order.payment?.rawCallback ?? {}) as Record<string, string>;
  const isAtmWaiting =
    order.status === "PENDING" && typeof raw.PayNo === "string" && raw.PayNo.length > 0;
  const firstCourse = order.items[0]?.course;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/orders" className="text-sm text-gray-500 hover:text-black">
        ← 訂單管理
      </Link>

      {/* ── 結帳完成／感謝區塊 ── */}
      {isPaid && (
        <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-2xl">🎉</p>
          <h2 className="mt-1 text-xl font-bold text-green-900">感謝您的購買！</h2>
          <p className="mt-1 text-sm text-green-800">
            付款已完成，課程已自動開通。電子發票將寄送至您的信箱。
          </p>
          {firstCourse && (
            <Link
              href={`/learn/${firstCourse.slug}`}
              className="mt-4 inline-block rounded-xl bg-green-700 px-8 py-3 font-bold text-white transition hover:bg-green-800"
            >
              前往上課 →
            </Link>
          )}
        </div>
      )}
      {isAtmWaiting && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-amber-900">🏧 請完成 ATM 轉帳</h2>
          <p className="mt-1 text-sm text-amber-800">
            取號成功！請於期限內轉帳，完成後課程將自動開通（無需回報）。
          </p>
          <dl className="mt-3 space-y-1 text-sm text-amber-900">
            {raw.BankType && (
              <div className="flex gap-2">
                <dt className="text-amber-700">銀行代碼：</dt>
                <dd className="font-mono font-bold">{raw.BankType}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-amber-700">繳費帳號：</dt>
              <dd className="font-mono font-bold">{raw.PayNo}</dd>
            </div>
            {raw.ExpireDate && (
              <div className="flex gap-2">
                <dt className="text-amber-700">繳費期限：</dt>
                <dd>{raw.ExpireDate}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {order.status === "PENDING" && !isAtmWaiting && (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-6 text-center">
          <h2 className="text-lg font-bold text-blue-900">付款確認中…</h2>
          <p className="mt-1 text-sm text-blue-800">
            正在與金流確認您的付款結果，頁面將自動更新（通常只需幾秒）。
          </p>
          <PendingRefresh />
        </div>
      )}

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
