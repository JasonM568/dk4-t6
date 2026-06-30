import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { buildBroadcastHtml } from "@/lib/email/broadcast";

export const metadata = { title: "寄送內容 — Email群發" };

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: "排程中", cls: "bg-amber-100 text-amber-700" },
  SENDING: { label: "寄送中", cls: "bg-blue-100 text-blue-700" },
  SENT: { label: "已寄出", cls: "bg-green-100 text-green-700" },
  CANCELED: { label: "已取消", cls: "bg-gray-100 text-gray-500" },
  FAILED: { label: "失敗", cls: "bg-red-100 text-red-700" },
};

export default async function BroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await pageGuardEditor();
  const { id } = await params;

  const record = await prisma.emailBroadcast.findUnique({ where: { id } });
  if (!record) notFound();

  // 信中帶課程連結時，明細頁也要重現課程卡
  const course = record.courseId
    ? await prisma.course.findUnique({
        where: { id: record.courseId },
        select: {
          title: true,
          slug: true,
          coverImage: true,
          price: true,
          listPrice: true,
        },
      })
    : null;

  // 用與實際寄送同一支函式產生 HTML → iframe 所見即所寄
  const html = buildBroadcastHtml(record.body, course);
  const badge = STATUS_BADGE[record.status] ?? STATUS_BADGE.SENT;
  const isScheduled = record.status === "SCHEDULED";
  const when = isScheduled ? record.scheduledAt : (record.sentAt ?? record.createdAt);

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/broadcast"
        className="text-sm text-indigo-600 hover:underline"
      >
        ← 回 Email群發
      </Link>

      <h1 className="mb-4 mt-2 text-2xl font-bold">{record.subject}</h1>

      {/* 寄送資訊 */}
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-gray-200 p-4 text-sm">
        <dt className="text-gray-500">狀態</dt>
        <dd>
          <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
            {badge.label}
          </span>
        </dd>

        <dt className="text-gray-500">{isScheduled ? "預定寄出" : "寄出時間"}</dt>
        <dd>{when ? when.toLocaleString("zh-TW", TPE) : "—"}</dd>

        <dt className="text-gray-500">對象</dt>
        <dd>{record.audienceLabel ?? "全部會員"}</dd>

        {!isScheduled && (
          <>
            <dt className="text-gray-500">成功 / 失敗</dt>
            <dd>
              <span className="text-green-600">{record.sentCount}</span>
              {" / "}
              <span className="text-red-600">{record.failedCount || 0}</span>
            </dd>
          </>
        )}

        {record.sentBy && (
          <>
            <dt className="text-gray-500">操作者</dt>
            <dd className="text-gray-600">{record.sentBy}</dd>
          </>
        )}
      </dl>

      {/* 實際寄出的 email 樣式 */}
      <h2 className="mb-2 text-lg font-bold">寄出內容</h2>
      <iframe
        title="email 預覽"
        srcDoc={html}
        className="h-[640px] w-full rounded-xl border border-gray-200 bg-white"
      />

      {/* 收件名單快照 */}
      {record.recipients.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:underline">
            收件名單（{record.recipients.length}）
          </summary>
          <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
            {record.recipients.map((email) => (
              <li key={email} className="py-0.5">
                {email}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
