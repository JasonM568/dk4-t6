import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProfile } from "@/lib/supabase/admin";
import { formatNT } from "@/lib/format";
import { grantEnrollmentAction, revokeEnrollment } from "@/actions/admin";
import { currentCanEdit } from "@/lib/auth/staff";
import { EnrollmentEditor } from "./enrollment-editor";

export const metadata = { title: "會員詳情 — 管理後台" };

const ORDER_STATUS: Record<string, { text: string; className: string }> = {
  PENDING: { text: "待付款", className: "bg-amber-50 text-amber-700" },
  PAID: { text: "已付款", className: "bg-green-50 text-green-700" },
  FAILED: { text: "付款失敗", className: "bg-red-50 text-red-700" },
  EXPIRED: { text: "已逾期", className: "bg-gray-100 text-gray-500" },
  REFUNDED: { text: "已退款", className: "bg-blue-50 text-blue-700" },
};

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 會員身分在 public.profiles（唯讀），課程資料在 course schema，應用層拼裝
  const [profile, stats, enrollments, orders, allCourses] = await Promise.all([
    getProfile(id),
    prisma.memberStats.findUnique({ where: { userId: id } }),
    prisma.enrollment.findMany({
      where: { userId: id },
      include: { course: { select: { title: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.findMany({
      where: { userId: id },
      include: {
        items: { include: { course: { select: { title: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true, isPublished: true },
    }),
  ]);
  const canEditNow = await currentCanEdit();
  if (!profile) notFound();

  // 方案 A：已開通清單 + 尚未開通的課程（給下拉選單）
  const enrolledRows = enrollments.map((e) => ({
    courseId: e.courseId,
    title: e.course.title,
    enrolledAt: e.createdAt.toISOString(),
    fromOrder: !!e.orderId,
    source: e.source,
    orderId: e.orderId,
  }));
  const enrolledIds = new Set(enrollments.map((e) => e.courseId));
  const availableCourses = allCourses.filter((c) => !enrolledIds.has(c.id));

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/members"
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 會員列表
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">
        {profile.display_name ?? profile.email ?? "會員詳情"}
      </h1>

      {/* 基本資料 */}
      <section className="rounded-xl border border-gray-200 p-5">
        <h2 className="mb-4 text-lg font-bold">基本資料</h2>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="姓名" value={profile.display_name ?? "—"} />
          <Item label="暱稱" value={profile.nickname ?? "—"} />
          <Item label="Email" value={profile.email ?? "—"} />
          <Item label="角色" value={profile.role ?? "student"} />
          <Item
            label="加入時間"
            value={
              profile.created_at
                ? new Date(profile.created_at).toLocaleString("zh-TW")
                : "—"
            }
          />
          <Item label="累積消費" value={formatNT(stats?.totalSpent ?? 0)} />
        </dl>
      </section>

      {/* 觀看權限（可勾選編輯） */}
      <section className="mt-8">
        <h2 className="mb-1 text-lg font-bold">
          課程觀看權限（已開通 {enrollments.length} 門）
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          {canEditNow
            ? "下方選單選擇課程後按「開通」即生效；移除權限會先跳確認。"
            : "唯讀檢視（總教練）"}
        </p>
        <EnrollmentEditor
          canEdit={canEditNow}
          enrolled={enrolledRows}
          available={availableCourses}
          grantAction={grantEnrollmentAction.bind(null, id)}
          revokeActions={Object.fromEntries(
            enrolledRows.map((e) => [
              e.courseId,
              revokeEnrollment.bind(null, id, e.courseId),
            ]),
          )}
        />
      </section>

      {/* 訂單清單 */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold">訂單紀錄（{orders.length}）</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">訂單編號</th>
                <th className="px-4 py-3">內容</th>
                <th className="px-4 py-3">金額</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-gray-400">
                    尚無訂單
                  </td>
                </tr>
              )}
              {orders.map((o) => {
                const s = ORDER_STATUS[o.status] ?? {
                  text: o.status,
                  className: "bg-gray-100 text-gray-500",
                };
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-mono text-xs">{o.orderNo}</td>
                    <td className="px-4 py-3">
                      {o.items.map((it) => it.course.title).join("、")}
                    </td>
                    <td className="px-4 py-3">{formatNT(o.total)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${s.className}`}
                      >
                        {s.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {o.createdAt.toLocaleDateString("zh-TW")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-gray-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
