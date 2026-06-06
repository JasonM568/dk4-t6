import { prisma } from "@/lib/db";
import { formatNT } from "@/lib/format";

export const metadata = { title: "後台總覽" };

export default async function AdminDashboard() {
  const [courseCount, userCount, paidOrders, revenue] = await Promise.all([
    prisma.course.count(),
    prisma.user.count(),
    prisma.order.count({ where: { status: "PAID" } }),
    prisma.order.aggregate({
      where: { status: "PAID" },
      _sum: { total: true },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">營運總覽</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="課程總數" value={`${courseCount}`} />
        <Card label="會員人數" value={`${userCount}`} />
        <Card label="成交訂單" value={`${paidOrders}`} />
        <Card label="總營收" value={formatNT(revenue._sum.total ?? 0)} />
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}
