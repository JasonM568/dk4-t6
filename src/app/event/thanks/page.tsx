import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "報名結果" };

// 場次線上金流付款完成的落地頁。狀態以 session-notify 寫入的訂單狀態為準：
// PAID = 已完成（名單已建、發票已開）；PENDING = 取號成功等繳款（ATM）或處理中。
export default async function SessionThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderNo } = await searchParams;
  const order = orderNo
    ? await prisma.sessionSignupOrder.findUnique({
        where: { orderNo },
        select: { status: true, quantity: true, paymentType: true, buyerEmail: true },
      })
    : null;

  const paid = order?.status === "PAID";
  const pending = order?.status === "PENDING";

  return (
    <main className="mx-auto max-w-lg px-5 py-16 text-center">
      <div
        className={`rounded-2xl border px-6 py-10 ${
          paid
            ? "border-green-200 bg-green-50"
            : pending
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50"
        }`}
      >
        {paid ? (
          <>
            <h1 className="mb-2 text-2xl font-bold text-green-800">報名完成！</h1>
            <p className="text-sm leading-relaxed text-green-900">
              我們已收到您 {order?.quantity} 位的報名與款項，確認信與發票將寄到{" "}
              {order?.buyerEmail}。期待課堂見！
            </p>
          </>
        ) : pending ? (
          <>
            <h1 className="mb-2 text-2xl font-bold text-amber-800">報名已收到，等待繳款</h1>
            <p className="text-sm leading-relaxed text-amber-900">
              您選擇的是 ATM／非即時付款。請依付款頁提供的帳號與期限完成繳費，
              我們收到款項後會再寄一封確認信，報名才算完成。
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-bold text-gray-800">報名結果處理中</h1>
            <p className="text-sm leading-relaxed text-gray-600">
              若您已完成付款卻看到這個畫面，款項確認可能需要一點時間；
              稍後仍未收到確認信，請與我們聯繫。
            </p>
          </>
        )}
      </div>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-red-800 underline underline-offset-2">
          回首頁
        </Link>
      </p>
    </main>
  );
}
