import { prisma } from "@/lib/db";
import { countProfiles } from "@/lib/supabase/admin";
import { sendBroadcastAction } from "@/actions/admin";
import { BroadcastForm } from "./broadcast-form";

export const metadata = { title: "群發通知 — 管理後台" };

export default async function BroadcastPage() {
  const [courses, memberCount, history] = await Promise.all([
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true },
    }),
    countProfiles(),
    prisma.emailBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">群發通知</h1>
      <p className="mb-6 text-sm text-gray-500">
        寄送課程上架通知等訊息給全部會員（目前 {memberCount} 位）。
        流程：填好內容 → 先寄測試信給自己確認版面 → 再正式群發。
      </p>

      <BroadcastForm
        courses={courses}
        memberCount={memberCount}
        sendAction={sendBroadcastAction}
      />

      {/* 寄送紀錄 */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-bold">寄送紀錄</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">時間</th>
                <th className="px-4 py-3">主旨</th>
                <th className="px-4 py-3">成功</th>
                <th className="px-4 py-3">失敗</th>
                <th className="px-4 py-3">操作者</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-gray-400">
                    尚無寄送紀錄
                  </td>
                </tr>
              )}
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-3 text-gray-500">
                    {h.createdAt.toLocaleString("zh-TW")}
                  </td>
                  <td className="px-4 py-3 font-medium">{h.subject}</td>
                  <td className="px-4 py-3 text-green-600">{h.sentCount}</td>
                  <td className="px-4 py-3 text-red-600">
                    {h.failedCount || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{h.sentBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
