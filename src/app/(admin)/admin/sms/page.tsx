import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { getSmsSettings, formatCents } from "@/lib/sms/settings";
import { getSmsProvider } from "@/lib/sms/provider";
import { resolveSmsFollowUp } from "@/lib/sms/dispatch";
import { cancelScheduledSmsAction, deleteSmsDraftAction } from "@/actions/sms";
import { SmsForm, type SmsInitial } from "./sms-form";
import { SubmitButton } from "@/components/admin/submit-button";

export const metadata = { title: "簡訊發送 — 管理後台" };

// 分批發送可能耗時，比照 Email 群發給足 300s
export const maxDuration = 300;

const TPE = { timeZone: "Asia/Taipei", hour12: false } as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  SCHEDULED: { label: "排程中", cls: "bg-amber-100 text-amber-700" },
  SENDING: { label: "發送中", cls: "bg-blue-100 text-blue-700" },
  SENT: { label: "已發送", cls: "bg-green-100 text-green-700" },
  CANCELED: { label: "已取消", cls: "bg-gray-100 text-gray-500" },
  FAILED: { label: "失敗", cls: "bg-red-100 text-red-700" },
};

const PAGE_SIZE = 20;

/** manualRows（JSON）→ 手動名單輸入框的文字：一行一筆「手機,姓名」。
 *  資料庫來的 JSON 一律防禦性讀取，壞資料就跳過那一筆。 */
function manualRowsToText(rows: unknown): string {
  if (!Array.isArray(rows)) return "";
  return rows
    .map((r) => {
      if (!r || typeof r !== "object") return "";
      const { mobile, name, code } = r as {
        mobile?: unknown;
        name?: unknown;
        code?: unknown;
      };
      if (typeof mobile !== "string" || !mobile) return "";
      const nm = typeof name === "string" ? name : "";
      // 第三欄是補發帶過來的查看碼；有碼就得連空姓名的逗號一起補上，
      // 否則碼會被當成姓名解析回去
      if (typeof code === "string" && /^\d{4}$/.test(code))
        return `${mobile},${nm},${code}`;
      return nm ? `${mobile},${nm}` : mobile;
    })
    .filter(Boolean)
    .join("\n");
}

/** Date → datetime-local 的值（台北時間）。已過期就回空字串，不要帶入送不出去的時間 */
function toTaipeiLocalInput(d: Date | null): string {
  if (!d || d.getTime() < Date.now() + 60_000) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return parts.replace(" ", "T");
}

export default async function SmsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    draft?: string;
    copy?: string;
    followup?: string;
  }>;
}) {
  await pageGuardEditor();
  const {
    page: pageRaw,
    draft: draftParam,
    copy: copyParam,
    followup: followUpParam,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  // 草稿：載回表單改同一筆；複製／補發：帶內容另存新的一則（原紀錄不動）
  const loadId = draftParam || copyParam || followUpParam;
  const source = loadId
    ? await prisma.smsBroadcast.findUnique({ where: { id: loadId } })
    : null;
  const editable = !!draftParam && source?.status === "DRAFT";
  // 補發：把「名單上還沒收到的人」算成手動名單快照帶進表單，
  // 管理員逐筆看得到號碼、可自行刪減後再送——不重跑原場次名單，避免整批重寄。
  const followUp = followUpParam ? await resolveSmsFollowUp(followUpParam) : null;

  const initial: SmsInitial | null = source
    ? {
        id: editable ? source.id : null,
        title: followUp ? `${source.title ?? "（未命名）"}（補發）` : (source.title ?? ""),
        body: source.body,
        audience: followUp
          ? "manual"
          : source.audienceType === "MANUAL"
            ? "manual"
            : "session",
        sessionIds: followUp ? [] : source.sessionIds,
        manualList: followUp
          ? followUp.rows
              .map((r) => (r.name ? `${r.mobile},${r.name}` : r.mobile))
              .join("\n")
          : manualRowsToText(source.manualRows),
        // 複製既有紀錄不沿用排程時間（多半已過期），只有編輯草稿才帶回
        scheduledAt: editable ? toTaipeiLocalInput(source.scheduledAt) : "",
        copiedFrom: editable || followUp ? null : (source.title ?? "既有紀錄"),
        followUp: followUp
          ? {
              sourceTitle: followUp.sourceTitle,
              count: followUp.rows.length,
              alreadySent: followUp.alreadySent,
              noMobileCount: followUp.noMobileCount,
              retryFailed: followUp.retryFailed,
              error: followUp.error ?? null,
            }
          : null,
      }
    : null;

  const provider = getSmsProvider();
  const [settings, sessions, history, total] = await Promise.all([
    getSmsSettings(),
    prisma.courseSession.findMany({
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        accessCode: true, // {code} 變數：這場有沒有碼可帶
        _count: { select: { signups: true } },
      },
    }),
    prisma.smsBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.smsBroadcast.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">簡訊發送</h1>
      <p className="mb-6 text-sm text-gray-500">
        發送上課提醒給場次報名者。名單於<strong>發送當下</strong>才解析，
        重複報名多場的學員只會收到一則。
      </p>

      {/* key：切換草稿/複製來源時強制重掛，表單內的狀態才會換成新內容 */}
      <SmsForm
        key={initial?.id ?? loadId ?? "new"}
        sessions={sessions.map((s) => ({
          id: s.id,
          title: s.title,
          signupCount: s._count.signups,
          accessCode: s.accessCode,
        }))}
        brandPrefix={settings.brandPrefix}
        isLive={provider.isLive}
        providerLabel={provider.label}
        initial={initial}
      />

      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">發送紀錄</h2>
          <span className="text-xs text-gray-400">
            單次上限 {settings.singleSendLimit} 則 · 每日上限 {settings.dailyLimit} 則 ·
            單價 {formatCents(Math.round(settings.pricePerSegment * 100))}/則
          </span>
        </div>

        {history.length === 0 ? (
          <p className="rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            尚無發送紀錄
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {/* table-fixed + 逐欄寬度：內容欄很長，不固定寬度會把「對象」和「結果」擠成一團 */}
            <table className="w-full table-fixed text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-3">標題／內容</th>
                  <th className="w-44 px-3 py-3">對象</th>
                  <th className="w-40 px-3 py-3">結果</th>
                  <th className="w-32 px-3 py-3">時間</th>
                  <th className="w-32 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => {
                  const badge = STATUS_BADGE[h.status] ?? {
                    label: h.status,
                    cls: "bg-gray-100 text-gray-600",
                  };
                  const when = h.sentAt ?? h.scheduledAt ?? h.createdAt;
                  return (
                    <tr key={h.id}>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/sms/${h.id}`}
                          className="font-medium hover:text-indigo-600 hover:underline"
                        >
                          {h.title ?? "（未命名）"}
                        </Link>
                        <div className="truncate text-xs text-gray-400" title={h.body}>
                          {h.body}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {/* 測試模式必須明確標示：不能讓人看到綠色「已發送」卻不知道沒真的送出去 */}
                          {h.provider === "dryrun" && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                              測試模式（未實際發送）
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-gray-500">
                        <div className="break-words">{h.audienceLabel ?? "—"}</div>
                        {h.noMobileCount > 0 && (
                          <div className="text-amber-600">
                            {h.noMobileCount} 人無手機
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs">
                        {h.status === "SENT" || h.status === "FAILED" ? (
                          <>
                            <div>
                              送出 {h.sentCount}
                              {h.failedCount > 0 && (
                                <span className="text-red-600"> · 失敗 {h.failedCount}</span>
                              )}
                            </div>
                            {/* 送達數才是「真的到手機」，與送出數分開顯示 */}
                            {h.deliveredCount > 0 && (
                              <div className="text-green-700">
                                已送達 {h.deliveredCount}
                              </div>
                            )}
                            <div className="text-gray-400">
                              {h.actualSegments} 則
                              {h.estimatedCostCents > 0 &&
                                ` · ${formatCents(h.estimatedCostCents)}`}
                            </div>
                            {h.excludedCount > 0 && (
                              <div className="text-gray-400">
                                排除退訂 {h.excludedCount}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs whitespace-nowrap text-gray-500">
                        {when.toLocaleString("zh-TW", TPE)}
                      </td>
                      <td className="px-3 py-3 text-right align-top">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {(h.status === "SENT" || h.status === "FAILED") && (
                          <Link
                            href={`/admin/sms/${h.id}`}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            明細
                          </Link>
                        )}
                        {h.status === "DRAFT" ? (
                          <Link
                            href={`/admin/sms?draft=${h.id}`}
                            className="rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50"
                          >
                            編輯
                          </Link>
                        ) : (
                          /* 上課提醒每場都差不多：複製既有內容改日期就能再發一次 */
                          <Link
                            href={`/admin/sms?copy=${h.id}`}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            複製
                          </Link>
                        )}
                        {/* 補發：發送後才報名／才補手機／上次送失敗的人，
                            算出差集帶進表單（已收到的絕不重寄） */}
                        {(h.status === "SENT" || h.status === "FAILED") &&
                          h.audienceType === "SESSION" && (
                            <Link
                              href={`/admin/sms?followup=${h.id}`}
                              title="把這場名單上「還沒收到」的人帶進表單（新報名、事後補手機、上次送失敗）"
                              className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50"
                            >
                              補發
                            </Link>
                          )}
                        {h.status === "SCHEDULED" && (
                          <form action={cancelScheduledSmsAction.bind(null, h.id)}>
                            <SubmitButton
                              pendingText="取消中…"
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
                            >
                              取消排程
                            </SubmitButton>
                          </form>
                        )}
                        {h.status === "DRAFT" && (
                          <form action={deleteSmsDraftAction.bind(null, h.id)}>
                            <SubmitButton
                              pendingText="刪除中…"
                              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                            >
                              刪除
                            </SubmitButton>
                          </form>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            {page > 1 && (
              <Link href={`/admin/sms?page=${page - 1}`} className="text-indigo-600 hover:underline">
                ← 上一頁
              </Link>
            )}
            <span className="text-gray-400">
              第 {page} / {totalPages} 頁
            </span>
            {page < totalPages && (
              <Link href={`/admin/sms?page=${page + 1}`} className="text-indigo-600 hover:underline">
                下一頁 →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
