import Link from "next/link";
import { prisma } from "@/lib/db";
import { countProfiles } from "@/lib/supabase/admin";
import {
  sendBroadcastAction,
  cancelScheduledBroadcast,
  saveBroadcastListToGroupAction,
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
  const [courses, memberCount, history, groups] = await Promise.all([
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true },
    }),
    countProfiles(),
    prisma.emailBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.mailGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const groupOptions = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g._count.members,
  }));

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">群發通知（電子報）</h1>
        <Link
          href="/admin/broadcast/groups"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
        >
          📋 名單群組（{groups.length}）
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        寄送 EDM 給全部會員、名單群組或手動貼入的名單。
        流程：填好內容 → 先寄測試信給自己確認版面 → 再正式群發（可設定預設發送時間）。
      </p>

      <BroadcastForm
        courses={courses}
        groups={groupOptions}
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
                <th className="px-4 py-3">對象</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">成功/失敗</th>
                <th className="px-4 py-3">名單</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-gray-400">
                    尚無寄送紀錄
                  </td>
                </tr>
              )}
              {history.map((h) => {
                const badge = STATUS_BADGE[h.status] ?? STATUS_BADGE.SENT;
                const manualRows = Array.isArray(h.manualRows)
                  ? (h.manualRows as unknown[])
                  : [];
                const listCount =
                  h.recipients.length > 0 ? h.recipients.length : manualRows.length;
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
                    <td className="px-4 py-3 font-medium">
                      {h.subject}
                      <span className="block text-xs font-normal text-gray-400">
                        {h.sentBy ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {h.audienceLabel ?? "全部會員"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {h.status === "SCHEDULED" ? (
                        "—"
                      ) : (
                        <>
                          <span className="text-green-600">{h.sentCount}</span>
                          {" / "}
                          <span className="text-red-600">
                            {h.failedCount || 0}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {h.status === "SCHEDULED" ? (
                        <form action={cancelScheduledBroadcast.bind(null, h.id)}>
                          <button className="text-sm text-red-600 hover:underline">
                            取消排程
                          </button>
                        </form>
                      ) : listCount > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-sm text-indigo-600 hover:underline">
                            存入群組（{listCount}）
                          </summary>
                          <form
                            action={saveBroadcastListToGroupAction.bind(
                              null,
                              h.id,
                            )}
                            className="mt-2 space-y-1.5"
                          >
                            <input
                              name="newName"
                              placeholder="新群組名稱"
                              className="w-36 rounded border border-gray-300 px-2 py-1 text-xs focus:border-black focus:outline-none"
                            />
                            {groupOptions.length > 0 && (
                              <select
                                name="groupId"
                                defaultValue=""
                                className="w-36 rounded border border-gray-300 px-2 py-1 text-xs focus:border-black focus:outline-none"
                              >
                                <option value="">或選既有群組</option>
                                {groupOptions.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button className="block rounded bg-black px-2.5 py-1 text-xs font-medium text-white">
                              存入
                            </button>
                          </form>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          「存入群組」會把該次寄送的名單加進群組（填新群組名稱或選既有群組，重複 email 自動略過）
        </p>
      </section>
    </div>
  );
}
