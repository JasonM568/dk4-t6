import { prisma } from "@/lib/db";
import {
  formatNT,
  formatDate,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
} from "@/lib/format";

export const metadata = { title: "訂單查詢" };

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    include: {
      user: true,
      items: { include: { course: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">訂單查詢（近 100 筆）</h1>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">訂單編號</th>
              <th className="px-4 py-3">會員</th>
              <th className="px-4 py-3">課程</th>
              <th className="px-4 py-3">金額</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">時間</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3 font-mono text-xs">{o.orderNo}</td>
                <td className="px-4 py-3">{o.user.email}</td>
                <td className="px-4 py-3">
                  {o.items.map((it) => it.course.title).join("、")}
                </td>
                <td className="px-4 py-3">{formatNT(o.total)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      ORDER_STATUS_COLOR[o.status]
                    }`}
                  >
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {formatDate(o.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
