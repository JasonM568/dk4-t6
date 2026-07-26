import Link from "next/link";
import { notFound } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import {
  applyMergeTags,
  buildBroadcastHtml,
  type FailedRecipient,
} from "@/lib/email/broadcast";
import { ResendFailedButton } from "./resend-failed-button";

export const metadata = { title: "寄送內容 — Email群發" };

// 補寄失敗者 action 由本頁送出（沿用本 segment 設定），最壞情況數百封也要跑得完
export const maxDuration = 300;

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
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

  // 成效統計（Resend webhook 回流；唯一人數）
  const eventGroups = await prisma.broadcastEvent.groupBy({
    by: ["type"],
    where: { broadcastId: id },
    _count: true,
  });
  const stats = Object.fromEntries(eventGroups.map((g) => [g.type, g._count]));
  const pct = (n: number) =>
    record.sentCount > 0 ? `（${Math.round((n / record.sentCount) * 100)}%）` : "";

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

  // 用與實際寄送同一支函式產生 HTML → iframe 所見即所寄；變數以範例收件人帶入
  const sampleRecipient = { email: "example@example.com", name: "王小明" };
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const html = buildBroadcastHtml(
    applyMergeTags(record.body, sampleRecipient),
    course,
    `${base}/unsubscribe`,
  );
  const badge = STATUS_BADGE[record.status] ?? STATUS_BADGE.SENT;
  const isScheduled = record.status === "SCHEDULED" || record.status === "DRAFT";
  const isEditable = record.status === "SCHEDULED" || record.status === "DRAFT";
  const when = isScheduled ? record.scheduledAt : (record.sentAt ?? record.createdAt);

  // 逐筆失敗名單（Json 欄位窄化；比照 dispatch.ts 對 manualRows 的處理）
  const failedList = Array.isArray(record.failedRecipients)
    ? (record.failedRecipients as FailedRecipient[])
    : [];
  const canResend =
    failedList.length > 0 &&
    (record.status === "SENT" || record.status === "FAILED");

  // 逐人投遞狀態：退信名單（含原因）與「寄出但尚未回報送達」名單。
  // 只有 webhook 有回流事件的寄送才算（老寄送沒事件，全列未送達會誤導）
  const hasEvents = eventGroups.length > 0;
  let bouncedList: { email: string; reason: string | null }[] = [];
  let pendingList: string[] = [];
  if (hasEvents && record.recipients.length > 0) {
    const events = await prisma.broadcastEvent.findMany({
      where: { broadcastId: id },
      select: { email: true, type: true },
    });
    // 有任何事件（送達/開信/點擊）都代表信已到；退信另列
    const bouncedSet = new Set(
      events.filter((e) => e.type === "BOUNCED").map((e) => e.email),
    );
    const receivedSet = new Set(
      events
        .filter((e) => e.type !== "BOUNCED" && e.type !== "COMPLAINED")
        .map((e) => e.email),
    );
    const reasons = bouncedSet.size
      ? await prisma.mailUnsubscribe.findMany({
          where: { email: { in: [...bouncedSet] } },
          select: { email: true, reason: true },
        })
      : [];
    const reasonMap = new Map(reasons.map((r) => [r.email, r.reason]));
    bouncedList = [...bouncedSet].map((email) => ({
      email,
      reason: reasonMap.get(email) ?? null,
    }));
    pendingList = record.recipients.filter(
      (email) => !receivedSet.has(email) && !bouncedSet.has(email),
    );
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/broadcast"
        className="text-sm text-indigo-600 hover:underline"
      >
        ← 回 Email群發
      </Link>

      <div className="mb-4 mt-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{record.subject}</h1>
        {isEditable && (
          <Link
            href={`/admin/broadcast/${record.id}/edit`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            ✏️ 編輯
          </Link>
        )}
      </div>

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
              {record.excludedCount > 0 && (
                <span className="ml-2 text-xs text-gray-400">
                  已排除退訂 {record.excludedCount} 筆
                </span>
              )}
            </dd>
          </>
        )}

        {record.sentCount > 0 && (
          <>
            <dt className="text-gray-500">成效</dt>
            <dd className="text-gray-700">
              送達 {stats.DELIVERED ?? 0} · 開信 {stats.OPENED ?? 0}
              {pct(stats.OPENED ?? 0)} · 點擊 {stats.CLICKED ?? 0}
              {pct(stats.CLICKED ?? 0)} · 退信{" "}
              <span className={stats.BOUNCED ? "text-red-600" : ""}>
                {stats.BOUNCED ?? 0}
              </span>
              <span className="mt-0.5 block text-xs text-gray-400">
                開信/點擊為唯一人數；需在 Resend 開啟 tracking 並設定 webhook
                後的新寄送才有數據
              </span>
            </dd>
          </>
        )}

        {record.sentBy && (
          <>
            <dt className="text-gray-500">操作者</dt>
            <dd className="text-gray-600">{record.sentBy}</dd>
          </>
        )}

        {record.resendOfId && (
          <>
            <dt className="text-gray-500">補寄來源</dt>
            <dd>
              <Link
                href={`/admin/broadcast/${record.resendOfId}`}
                className="text-indigo-600 hover:underline"
              >
                查看原始群發 →
              </Link>
            </dd>
          </>
        )}

        {record.audienceType === "FOLLOWUP" && record.sourceBroadcastId && (
          <>
            <dt className="text-gray-500">跟進來源</dt>
            <dd>
              <Link
                href={`/admin/broadcast/${record.sourceBroadcastId}`}
                className="text-indigo-600 hover:underline"
              >
                查看來源群發 →
              </Link>
            </dd>
          </>
        )}
      </dl>

      {/* 建立跟進信：對此群發的開信/未開信/點擊名單再寄一封（名單於寄出當下解析） */}
      {record.status === "SENT" && record.sentCount > 0 && (
        <div className="mb-6 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
          <h2 className="mb-1 text-sm font-bold text-cyan-800">📬 建立跟進信</h2>
          <p className="mb-3 text-xs text-cyan-700">
            對這封信的特定名單再寄一封（例如隔天提醒未開信者）。名單在「寄出當下」才解析，
            現在建立排程也不會漏掉晚開信的人。
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            {(
              [
                { filter: "OPENED", label: "開信者", count: stats.OPENED ?? 0 },
                {
                  filter: "NOT_OPENED",
                  label: "未開信者",
                  count:
                    record.recipients.length > 0
                      ? Math.max(
                          0,
                          record.recipients.length -
                            (stats.OPENED ?? 0) -
                            (stats.BOUNCED ?? 0),
                        )
                      : null, // 舊紀錄無名單快照 → 不提供未開信者跟進
                },
                { filter: "CLICKED", label: "點擊者", count: stats.CLICKED ?? 0 },
                {
                  filter: "OPENED_NOT_CLICKED",
                  label: "開信未點擊",
                  count: Math.max(0, (stats.OPENED ?? 0) - (stats.CLICKED ?? 0)),
                },
              ] as const
            ).map((opt) =>
              opt.count === null ? null : opt.count > 0 ? (
                <Link
                  key={opt.filter}
                  href={`/admin/broadcast?followUp=${record.id}&filter=${opt.filter}`}
                  className="rounded-lg border border-cyan-300 bg-white px-3 py-1.5 font-medium text-cyan-800 transition hover:bg-cyan-100"
                >
                  跟進{opt.label}（{opt.count}）
                </Link>
              ) : (
                <span
                  key={opt.filter}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-gray-400"
                  title="目前沒有符合的收件人"
                >
                  跟進{opt.label}（0）
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {/* 失敗名單＋補寄 */}
      {failedList.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-sm font-bold text-red-700">
              失敗名單（{failedList.length}）
            </h2>
            {canResend && (
              <ResendFailedButton
                broadcastId={record.id}
                count={failedList.length}
              />
            )}
          </div>
          <ul className="max-h-64 overflow-auto rounded-lg border border-red-100 bg-white p-3 text-xs">
            {failedList.map((f) => (
              <li key={f.email} className="flex justify-between gap-4 py-0.5">
                <span className="text-gray-700">
                  {f.email}
                  {f.name ? `（${f.name}）` : ""}
                </span>
                <span className="text-gray-400">{f.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            補寄只會寄給上列失敗的收件人，會另開一筆寄送紀錄；補寄成功者會從此名單移除。
          </p>
        </div>
      )}

      {/* 逐人投遞狀態（webhook 回流後才有） */}
      {(bouncedList.length > 0 || pendingList.length > 0) && (
        <div className="mb-6 space-y-3">
          {bouncedList.length > 0 && (
            <details className="rounded-xl border border-red-200 bg-red-50/50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-red-700">
                📮 退信名單（{bouncedList.length}）— 信箱收不到，已自動列入排除
              </summary>
              <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-red-100 bg-white p-3 text-xs">
                {bouncedList.map((b) => (
                  <li key={b.email} className="flex justify-between gap-4 py-0.5">
                    <span className="text-gray-700">{b.email}</span>
                    <span className="text-gray-400">{b.reason ?? "退信"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                退信信箱已自動加入排除名單，之後群發不會再寄。多半是報名時打錯字或公司信箱擋信
                → 建議個案聯繫確認正確 email 後，到名單群組修正。
              </p>
            </details>
          )}
          {pendingList.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-amber-700">
                ⏳ 已寄出、尚未回報送達（{pendingList.length}）
              </summary>
              <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-amber-100 bg-white p-3 text-xs text-gray-700">
                {pendingList.map((email) => (
                  <li key={email} className="py-0.5">
                    {email}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                通常是對方信箱（常見 Gmail）暫時延遲收信，系統會自動重試投遞最長 72
                小時，此名單會隨送達回報自動縮短；72 小時後仍在此名單才需要個案處理。
              </p>
            </details>
          )}
        </div>
      )}

      {/* 實際寄出的 email 樣式 */}
      <h2 className="mb-2 text-lg font-bold">寄出內容</h2>
      <p className="mb-2 text-xs text-gray-400">
        以下以範例收件人（example@example.com／王小明）呈現；內文中的{" "}
        <span className="font-mono">{"{email}"}</span>／
        <span className="font-mono">{"{name}"}</span>{" "}
        與底部退訂連結，實際寄出時會替換成各收件人的值。
      </p>
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
