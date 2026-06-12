import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";

export const metadata = { title: "訂單管理" };

export default async function OrdersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { course: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold">訂單管理</h1>

      {orders.length === 0 ? (
        <p className="text-gray-500">尚無訂單。</p>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.orderNo}`}
              className="block rounded-xl border border-gray-200 p-4 transition hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm text-gray-500">
                  {o.orderNo}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    ORDER_STATUS_COLOR[o.status]
                  }`}
                >
                  {ORDER_STATUS_LABEL[o.status]}
                </span>
              </div>
              <div className="mt-2 text-sm text-gray-700">
                {o.items.map((it) => it.course.title).join("、")}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-gray-400">{formatDate(o.createdAt)}</span>
                <span className="font-bold">{formatNT(o.total)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
