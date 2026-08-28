import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { countProfiles, listProfiles } from "@/lib/supabase/admin";
import {
  sendBroadcastAction,
  cancelScheduledBroadcast,
  deleteDraftBroadcastAction,
  deleteMailTemplateAction,
  saveBroadcastListToGroupAction,
} from "@/actions/admin";
import { BroadcastForm } from "./broadcast-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { buildFollowUpProp } from "./followup-stats";
import { toDatetimeLocal } from "./datetime";
import { isFollowUpFilter } from "@/lib/email/followup";
import { BROADCAST_PRESETS } from "@/lib/email/presets";
import { buildClassNoticeEmail } from "@/lib/class-notice";
import { DeleteTemplateButton } from "./delete-template-button";

export const metadata = { title: "Email群發 — 管理後台" };

// 立即群發（server action 沿用本 segment 設定）數百封分批＋退避重試需要時間，明確給足 300s
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

const PAGE_SIZE = 20;

export default async function BroadcastPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    from?: string;
    tpl?: string;
    preset?: string;
    // 從場次看板「發課前通知」帶過來：勾好場次並填好草稿
    session?: string;
    // 場次名單列的「EDM」：只寄給這一位（手動名單自動填好該學員）
    signup?: string;
    followUp?: string;
    filter?: string;
  }>;
}) {
  await pageGuardEditor();
  const {
    page: pageRaw,
    from,
    tpl,
    preset,
    followUp: followUpId,
    filter,
    session: sessionParam,
    signup: signupParam,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  // 舊信帶入：?from=<broadcastId> 把該封信的主旨/內文/關聯課程帶進表單
  // （收件對象不帶，重寄時自行選擇，避免誤發整批名單）
  const template = from
    ? await prisma.emailBroadcast.findUnique({
        where: { id: from },
        select: { subject: true, body: true, courseId: true },
      })
    : null;

  // 範本庫帶入：?tpl=<templateId>（與 ?from 同款流程，內容來源改為 MailTemplate）
  const savedTemplate = !template && tpl
    ? await prisma.mailTemplate.findUnique({ where: { id: tpl } })
    : null;
  const selectedPreset = !template && !savedTemplate
    ? BROADCAST_PRESETS.find((p) => p.id === preset) ?? null
    : null;

  // 跟進信模式：?followUp=<broadcastId>&filter=OPENED|NOT_OPENED|CLICKED
  // 來源必須是已寄出（SENT）的群發，否則忽略參數
  let followUpProp = null;
  if (followUpId && filter && isFollowUpFilter(filter)) {
    const src = await prisma.emailBroadcast.findUnique({
      where: { id: followUpId },
      select: { status: true },
    });
    if (src?.status === "SENT") {
      followUpProp = await buildFollowUpProp(followUpId, filter);
    }
  }

  const [
    courses,
    memberCount,
    history,
    totalCount,
    groups,
    sessions,
    profiles,
    templates,
  ] = await Promise.all([
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true },
    }),
    countProfiles(),
    prisma.emailBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.emailBroadcast.count(),
    prisma.mailGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // 場次看板的場次：課前通知的收件名單來源（與簡訊模組同一份）；
    // 人數扣掉已延期到別場的人，與寄出時的名單條件一致
    prisma.courseSession.findMany({
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        // 「發課前通知」帶過來時，用這些欄位長出草稿內容
        eventDate: true,
        accessCode: true,
        meetingUrl: true,
        meetingInfo: true,
        _count: { select: { signups: { where: { deferredToSessionId: null } } } },
      },
    }),
    listProfiles(),
    // 範本庫：最近更新在前
    prisma.mailTemplate.findMany({ orderBy: { updatedAt: "desc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // 「選取會員」勾選用的會員清單
  const memberOptions = profiles
    .filter((p) => p.email)
    .map((p) => ({
      email: p.email!,
      name: p.display_name ?? p.nickname ?? "",
    }));

  // 本頁紀錄的開信/點擊統計（一次 groupBy 防 N+1）
  const eventGroups = await prisma.broadcastEvent.groupBy({
    by: ["broadcastId", "type"],
    where: {
      broadcastId: { in: history.map((h) => h.id) },
      type: { in: ["OPENED", "CLICKED"] },
    },
    _count: true,
  });
  const eventStats = new Map<string, { opened: number; clicked: number }>();
  for (const g of eventGroups) {
    const s = eventStats.get(g.broadcastId) ?? { opened: 0, clicked: 0 };
    if (g.type === "OPENED") s.opened = g._count;
    if (g.type === "CLICKED") s.clicked = g._count;
    eventStats.set(g.broadcastId, s);
  }

  const groupOptions = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g._count.members,
  }));
  const sessionOptions = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    signupCount: s._count.signups,
  }));

  // 從場次看板「發課前通知」進來：勾好場次、填好主旨與內文，
  // 並預設標為履約通知（課前通知本來就是——退訂電子報的學員仍該收到）。
  // 明確帶了範本／推薦範本／跟進信時不覆蓋。
  const noticeSession =
    sessionParam && !tpl && !preset && !followUpId
      ? sessions.find((x) => x.id === sessionParam)
      : undefined;
  const noticeDraft = noticeSession ? buildClassNoticeEmail(noticeSession) : null;
  // 帶 signup=<id>：只寄給名單上這一位（晚報名/沒收到的人補寄）——
  // 改走手動名單並自動填好「email,姓名」，內容仍是課前通知草稿、仍標履約通知
  const singleSignup =
    signupParam && noticeSession
      ? await prisma.sessionSignup.findUnique({
          where: { id: signupParam },
          select: { name: true, email: true, sessionId: true },
        })
      : null;
  const singleRecipient =
    singleSignup?.email && singleSignup.sessionId === noticeSession?.id
      ? singleSignup
      : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Email群發（電子報）</h1>
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

      {/* 常用範本：點名稱帶入表單；「存成範本」按鈕在表單下方 */}
      {templates.length > 0 && !followUpProp && (
        <section className="mb-4 rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-medium">
            📄 常用範本（{templates.length}）
          </h2>
          <ul className="divide-y divide-gray-100">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-1.5 text-sm">
                <Link
                  href={`/admin/broadcast?tpl=${t.id}`}
                  className={`font-medium hover:underline ${
                    savedTemplate?.id === t.id
                      ? "text-indigo-800"
                      : "text-indigo-600"
                  }`}
                  title="帶入此範本的主旨／內文／關聯課程"
                >
                  {savedTemplate?.id === t.id ? "▸ " : ""}
                  {t.name}
                </Link>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
                  {t.subject}
                </span>
                <DeleteTemplateButton
                  templateName={t.name}
                  deleteAction={deleteMailTemplateAction.bind(null, t.id)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-400">
            點範本名稱帶入表單，小幅修改後即可寄出；範本只存內容（主旨／內文／關聯課程），發送對象每次自行選擇。
            要新增範本：在下方表單填好內容後按「存成範本」。
          </p>
        </section>
      )}

      {!followUpProp && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="mb-2 text-sm font-medium text-amber-900">✨ 推薦 EDM 範本</h2>
          <div className="space-y-2">
            {BROADCAST_PRESETS.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/80 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/broadcast?preset=${p.id}`}
                    className={`font-medium hover:underline ${selectedPreset?.id === p.id ? "text-amber-900" : "text-indigo-600"}`}
                  >
                    {selectedPreset?.id === p.id ? "▸ " : ""}{p.name}
                  </Link>
                  <p className="text-xs text-gray-500">{p.description}</p>
                </div>
                <Link
                  href={`/admin/broadcast?preset=${p.id}`}
                  className="rounded border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  載入並預覽
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-800">
            載入後請補上課程日期、地點、截止日與正確報名連結；範本不會自動選取或寄送任何名單。
          </p>
        </section>
      )}

      {template && (
        <div className="mb-4 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          📄 已帶入範本「{template.subject}」——主旨、內文、關聯課程已填好，
          選擇發送對象即可寄出（
          <Link href="/admin/broadcast" className="underline">
            清除範本
          </Link>
          ）
        </div>
      )}
      {savedTemplate && (
        <div className="mb-4 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          📄 已帶入範本「{savedTemplate.name}」——主旨、內文、關聯課程已填好，
          修改後選擇發送對象即可寄出（
          <Link href="/admin/broadcast" className="underline">
            清除範本
          </Link>
          ）
        </div>
      )}
      {selectedPreset && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ✨ 已載入推薦範本「{selectedPreset.name}」並開啟即時預覽。請確認活動資訊與報名連結後，再選擇收件名單。
        </div>
      )}
      {followUpProp && (
        <div className="mb-4 rounded-lg bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
          📬 正在建立跟進信——寄給「{followUpProp.sourceSubject}」的
          <span className="font-medium">{followUpProp.filterLabel}</span>
          （目前約 {followUpProp.estimatedCount} 人，名單於寄出當下解析）。
          寫好內容後建議用排程寄出（
          <Link href="/admin/broadcast" className="underline">
            離開跟進模式
          </Link>
          ）
        </div>
      )}
      <BroadcastForm
        key={from ?? tpl ?? preset ?? (sessionParam ? `${sessionParam}-${signupParam ?? ""}` : null) ?? (followUpProp ? `fu-${followUpProp.sourceId}-${followUpProp.filter}` : "blank")}
        courses={courses}
        groups={groupOptions}
        sessions={sessionOptions}
        memberCount={memberCount}
        members={memberOptions}
        sendAction={sendBroadcastAction}
        followUp={followUpProp ?? undefined}
        initialPreview={!!selectedPreset}
        defaultValues={
          noticeDraft && noticeSession
            ? {
                subject: noticeDraft.subject,
                body: noticeDraft.body,
                courseId: "",
                audience: singleRecipient ? "manual" : "session",
                groupIds: [],
                sessionIds: singleRecipient ? [] : [noticeSession.id],
                isNotice: true,
                manualList: singleRecipient
                  ? `${singleRecipient.email},${singleRecipient.name}`
                  : "",
                scheduledAt: "",
              }
            : template || savedTemplate || selectedPreset
            ? {
                subject: (template ?? savedTemplate ?? selectedPreset)!.subject,
                body: (template ?? savedTemplate ?? selectedPreset)!.body,
                courseId: (template ?? savedTemplate)?.courseId ?? "",
                audience: "all",
                groupIds: [],
                sessionIds: [],
                isNotice: false,
                manualList: "",
                scheduledAt: "",
              }
            : followUpProp
              ? {
                  subject: "",
                  body: "",
                  courseId: "",
                  audience: "all",
                  groupIds: [],
                  sessionIds: [],
                  isNotice: false,
                  manualList: "",
                  // 跟進信預設隔天同時段寄出（可自行調整）；
                  // server component 每次請求都重新渲染，取當下時間是刻意行為
                  scheduledAt: toDatetimeLocal(
                    // eslint-disable-next-line react-hooks/purity
                    new Date(Date.now() + 24 * 60 * 60 * 1000),
                  ),
                }
              : undefined
        }
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
                <th className="px-4 py-3">開信/點擊</th>
                <th className="px-4 py-3">名單</th>
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
                      <Link
                        href={`/admin/broadcast/${h.id}`}
                        className="text-indigo-600 hover:underline"
                        title="查看寄出內容"
                      >
                        {h.subject}
                      </Link>
                      <span className="block text-xs font-normal text-gray-400">
                        {h.sentBy ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {h.audienceLabel ?? "全部會員"}
                      {/* 履約通知走的是不同的退訂規則，紀錄上必須看得出來 */}
                      {h.messageType === "NOTICE" && (
                        <span
                          className="ml-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700"
                          title="履約通知：只排除退信與檢舉垃圾信，不受行銷退訂影響"
                        >
                          履約通知
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {h.status === "SCHEDULED" || h.status === "DRAFT" ? (
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
                      {h.sentCount > 0 ? (
                        (() => {
                          const s = eventStats.get(h.id) ?? { opened: 0, clicked: 0 };
                          const p = (n: number) => Math.round((n / h.sentCount) * 100);
                          return (
                            <span className="whitespace-nowrap">
                              <span className="font-medium text-emerald-700">
                                {s.opened}
                              </span>
                              <span className="text-xs text-emerald-600">
                                （{p(s.opened)}%）
                              </span>
                              <span className="text-gray-300"> / </span>
                              <span className="font-medium text-indigo-700">
                                {s.clicked}
                              </span>
                              <span className="text-xs text-indigo-600">
                                （{p(s.clicked)}%）
                              </span>
                            </span>
                          );
                        })()
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {h.status === "DRAFT" ? (
                        <span className="flex items-center gap-3">
                          <Link
                            href={`/admin/broadcast/${h.id}/edit`}
                            className="text-sm text-indigo-600 hover:underline"
                          >
                            繼續編輯
                          </Link>
                          <form action={deleteDraftBroadcastAction.bind(null, h.id)}>
                            <SubmitButton
                              pendingText="刪除中…"
                              className="text-sm text-red-600 hover:underline"
                            >
                              刪除
                            </SubmitButton>
                          </form>
                        </span>
                      ) : h.status === "SCHEDULED" ? (
                        <span className="flex items-center gap-3">
                          <Link
                            href={`/admin/broadcast/${h.id}/edit`}
                            className="text-sm text-indigo-600 hover:underline"
                          >
                            編輯
                          </Link>
                          <form action={cancelScheduledBroadcast.bind(null, h.id)}>
                            <SubmitButton
                              pendingText="取消中…"
                              className="text-sm text-red-600 hover:underline"
                            >
                              取消排程
                            </SubmitButton>
                          </form>
                        </span>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Link
                            href={`/admin/broadcast?from=${h.id}`}
                            className="text-sm text-indigo-600 hover:underline"
                            title="把這封信的主旨/內文/關聯課程帶入上方表單，選對象即可重寄"
                          >
                            📄 以此為範本
                          </Link>
                          {listCount > 0 && (
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
                            <SubmitButton
                              pendingText="存入中…"
                              className="block rounded bg-black px-2.5 py-1 text-xs font-medium text-white"
                            >
                              存入
                            </SubmitButton>
                          </form>
                        </details>
                          )}
                        </span>
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
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <Link
                href={`/admin/broadcast?page=${page - 1}`}
                className="text-indigo-600 hover:underline"
              >
                ← 上一頁
              </Link>
            ) : (
              <span className="text-gray-300">← 上一頁</span>
            )}
            <span className="text-gray-500">
              第 {page} / {totalPages} 頁（共 {totalCount} 筆）
            </span>
            {page < totalPages ? (
              <Link
                href={`/admin/broadcast?page=${page + 1}`}
                className="text-indigo-600 hover:underline"
              >
                下一頁 →
              </Link>
            ) : (
              <span className="text-gray-300">下一頁 →</span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
