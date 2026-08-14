import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/sms/settings";
import { formatMobile } from "@/lib/sms/phone";
import { RefreshDeliveryButton } from "./refresh-button";

export const metadata = { title: "簡訊發送明細 — 管理後台" };

// 逐筆向簡訊商查狀態可能要幾十秒，比照群發給足時間
export const maxDuration = 300;

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

/** 狀態顯示：sent 只代表電信已接收，還沒到手機——文案要講清楚，
 *  不然「已發送」會被當成「已送到」。 */
const STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  QUEUED: { label: "待送出", cls: "bg-gray-100 text-gray-600", hint: "簡訊商已收下，尚未送給電信" },
  SENT: { label: "已送出", cls: "bg-blue-100 text-blue-700", hint: "電信已接收，等待手機端回報送達" },
  DELIVERED: { label: "已送達", cls: "bg-green-100 text-green-700", hint: "電信回報已送到手機" },
  FAILED: { label: "失敗", cls: "bg-red-100 text-red-700", hint: "送不出去，看右方原因" },
  STOP: { label: "拒收", cls: "bg-amber-100 text-amber-800", hint: "收件人退訂／電信端拒收，已加入退訂名單" },
};

export default async function SmsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await pageGuardEditor();
  const { id } = await params;
  const record = await prisma.smsBroadcast.findUnique({
    where: { id },
    include: { messages: { orderBy: [{ status: "asc" }, { mobile: "asc" }] } },
  });
  if (!record) notFound();

  const count = (s: string) => record.messages.filter((m) => m.status === s).length;
  const when = record.sentAt ?? record.scheduledAt ?? record.createdAt;
  // 舊紀錄（逐筆追蹤上線前送的）沒有 messages，要說明清楚而不是顯示 0
  const legacy = record.messages.length === 0 && record.status === "SENT";

  return (
    <div className="max-w-4xl">
      <Link href="/admin/sms" className="text-sm text-indigo-600 hover:underline">
        ← 回簡訊發送
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{record.title ?? "（未命名）"}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {record.audienceLabel ?? "—"}｜{when.toLocaleString("zh-TW", TPE)}
        {record.provider === "dryrun" && "｜測試模式（未實際發送）"}
      </p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm whitespace-pre-wrap">
        {record.body}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-700">
          已送達 {count("DELIVERED")}
        </span>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">
          已送出待回報 {count("SENT") + count("QUEUED")}
        </span>
        <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
          失敗 {count("FAILED")}
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
          拒收 {count("STOP")}
        </span>
        {record.noMobileCount > 0 && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">
            無手機收不到 {record.noMobileCount}
          </span>
        )}
        <span className="text-xs text-gray-400">
          {record.actualSegments} 則
          {record.estimatedCostCents > 0 && ` · ${formatCents(record.estimatedCostCents)}`}
        </span>
        <RefreshDeliveryButton broadcastId={record.id} />
      </div>
      <p className="mt-1 text-xs text-gray-400">
        「已送出」是電信已接收、還沒回報到手機；系統每 5 分鐘會自動更新一次，
        電信通常幾秒到幾分鐘內回報，收訊不良或關機可能拖到數小時。
      </p>

      {legacy ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
          這則是「逐筆追蹤」上線前發送的，沒有留下每個人的簡訊編號，因此查不到個別送達狀態。
          <br />
          當時的結果：成功送出 {record.sentCount} 人
          {record.failedCount > 0 && `、失敗 ${record.failedCount} 人`}。
        </p>
      ) : record.messages.length === 0 ? (
        <p className="mt-6 rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          尚未發送，沒有逐筆紀錄
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="w-40 px-4 py-3">姓名</th>
                <th className="w-36 px-4 py-3">手機</th>
                <th className="w-28 px-4 py-3">狀態</th>
                <th className="w-40 px-4 py-3">送達時間</th>
                <th className="px-4 py-3">失敗原因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {record.messages.map((m) => {
                const s = STATUS[m.status] ?? {
                  label: m.status,
                  cls: "bg-gray-100 text-gray-600",
                  hint: "",
                };
                return (
                  <tr key={m.id}>
                    <td className="truncate px-4 py-2">{m.name ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">
                      {formatMobile(m.mobile)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        title={s.hint}
                        className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {m.deliveredAt ? m.deliveredAt.toLocaleString("zh-TW", TPE) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-red-600">{m.error ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
