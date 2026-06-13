import { prisma } from "@/lib/db";
import { pageGuardFullAdmin } from "@/lib/auth/staff";
import { removeStaffRoleAction } from "@/actions/admin";
import { formatDate } from "@/lib/format";
import { SubmitButton } from "@/components/admin/submit-button";
import { AssignStaffForm } from "./assign-form";

export const metadata = { title: "權限管理 — 管理後台" };

const ROLE_LABEL: Record<string, { text: string; cls: string }> = {
  OPERATOR: { text: "操作人員", cls: "bg-blue-50 text-blue-700" },
  COACH: { text: "總教練", cls: "bg-amber-50 text-amber-700" },
};

export default async function StaffPage() {
  await pageGuardFullAdmin(); // 僅管理員

  const staff = await prisma.staffRole.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">權限管理</h1>
      <p className="mb-6 text-sm text-gray-500">
        指派幹部角色。<strong>管理員</strong>為最高權限（全站查看+編輯，沿用希望學院帳號角色，不在此指派）；
        <strong>操作人員</strong>可查看+編輯訂單/課程/會員、匯出、批次開通、群發；
        <strong>總教練</strong>只能查看訂單/課程清單/會員清單（唯讀）。
      </p>

      <AssignStaffForm />

      <h2 className="mt-8 mb-3 text-lg font-bold">目前的幹部（{staff.length}）</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">指派者</th>
              <th className="px-4 py-3">指派時間</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  尚未指派任何幹部
                </td>
              </tr>
            )}
            {staff.map((s) => {
              const badge = ROLE_LABEL[s.role] ?? {
                text: s.role,
                cls: "bg-gray-100 text-gray-600",
              };
              return (
                <tr key={s.userId}>
                  <td className="px-4 py-3">{s.email ?? s.userId}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}
                    >
                      {badge.text}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.assignedBy ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={removeStaffRoleAction.bind(null, s.userId)}>
                      <SubmitButton
                        pendingText="移除中…"
                        className="text-sm text-red-600 hover:underline"
                      >
                        移除
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
