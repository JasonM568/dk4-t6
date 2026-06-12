import { prisma } from "@/lib/db";
import { countProfiles } from "@/lib/supabase/admin";
import {
  sendBroadcastAction,
  cancelScheduledBroadcast,
} from "@/actions/admin";
import { BroadcastForm } from "./broadcast-form";

export const metadata = { title: "群發通知 — 管理後台" };

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: "排程中", cls: "bg-amber-100 text-amber-700" },
  SENDING: { label: "寄送中", cls: "bg-blue-100 text-blue-700" },
  SENT: { label: "已寄出", cls: "bg-green-100 text-green-700" },
  CANCELED: { label: "已取消", cls: "bg-gray-100 text-gray-500" },
  FAILED: { label: "失敗", cls: "bg-red-100 text-red-700" },
};

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
        流程：填好內容 → 先寄測試信給自己確認版面 → 再正式群發（可設定預設發送時間）。
      </p>

      <BroadcastForm
        courses={courses}
        memberCount={memberCount}
        sendAction={sendBroadcastAction}
      />

      {/* 寄送紀錄（含排程） */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-bold">寄送紀錄</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">時間</th>
                <th className="px-4 py-3">主旨</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">成功</th>
                <th className="px-4 py-3">失敗</th>
                <th className="px-4 py-3">操作者</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-gray-400">
                    尚無寄送紀錄
                  </td>
                </tr>
              )}
              {history.map((h) => {
                const badge = STATUS_BADGE[h.status] ?? STATUS_BADGE.SENT;
                return (
                  <tr key={h.id}>
                    <td className="px-4 py-3 text-gray-500">
                      {h.status === "SCHEDULED" && h.scheduledAt ? (
                        <>
                          <span className="font-medium text-amber-700">
                            {h.scheduledAt.toLocaleString("zh-TW", TPE)}
                          </span>
                          <span className="block text-xs text-gray-400">
                            建立於 {h.createdAt.toLocaleString("zh-TW", TPE)}
                          </span>
                        </>
                      ) : (
                        (h.sentAt ?? h.createdAt).toLocaleString("zh-TW", TPE)
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{h.subject}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-green-600">
                      {h.status === "SCHEDULED" ? "—" : h.sentCount}
                    </td>
                    <td className="px-4 py-3 text-red-600">
                      {h.failedCount || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{h.sentBy ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {h.status === "SCHEDULED" && (
                        <form action={cancelScheduledBroadcast.bind(null, h.id)}>
                          <button className="text-sm text-red-600 hover:underline">
                            取消排程
                          </button>
                        </form>
                      )}
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
