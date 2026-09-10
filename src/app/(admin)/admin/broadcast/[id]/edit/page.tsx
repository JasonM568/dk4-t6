import Link from "next/link";
import { redirect } from "next/navigation";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { countProfiles, listProfiles } from "@/lib/supabase/admin";
import { updateBroadcastAction } from "@/actions/admin";
import {
  BroadcastForm,
  type BroadcastFormDefaults,
} from "../../broadcast-form";
import { toDatetimeLocal } from "../../datetime";
import { buildFollowUpProp } from "../../followup-stats";
import { isFollowUpFilter } from "@/lib/email/followup";
import {
  broadcastGroupIds,
  broadcastSessionIds,
  broadcastWebinarIds,
} from "@/lib/email/audience";
import { hasEndedInTaipei } from "@/lib/board-expiry";

export const metadata = { title: "編輯群發 — Email群發" };

// 編輯頁可直接立即寄出（沿用本 segment 設定），數百封也要跑得完
export const maxDuration = 300;

export default async function BroadcastEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await pageGuardEditor();
  const { id } = await params;

  const record = await prisma.emailBroadcast.findUnique({ where: { id } });
  // 只有排程中/草稿可編輯；其他狀態（已寄出等）回明細頁
  if (!record || (record.status !== "SCHEDULED" && record.status !== "DRAFT")) {
    redirect(`/admin/broadcast/${id}`);
  }

  const [courses, memberCount, groups, sessions, webinars, profiles, marketingPages] =
    await Promise.all([
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true },
    }),
    countProfiles(),
    prisma.mailGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // 場次看板：課前通知的名單來源（與簡訊模組共用同一份場次報名資料）
    prisma.courseSession.findMany({
      orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        _count: { select: { signups: { where: { deferredToSessionId: null } } } },
      },
    }),
    // 講座索取名單：連已結束的一起撈（同 /admin/broadcast 與 /admin/sms）
    prisma.webinar.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        isActive: true,
        endDate: true,
        unpublishAt: true,
        requests: { select: { email: true } },
      },
    }),
    listProfiles(),
    // 行銷頁（/p/<slug>）：工具列「🎬 行銷頁」下拉
    prisma.customPage.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { slug: true, title: true },
    }),
  ]);

  // 跟進信：來源與條件唯讀（要換條件請取消排程後從來源明細頁重建）
  const followUp =
    record.audienceType === "FOLLOWUP" &&
    record.sourceBroadcastId &&
    record.followUpFilter &&
    isFollowUpFilter(record.followUpFilter)
      ? await buildFollowUpProp(record.sourceBroadcastId, record.followUpFilter)
      : undefined;

  // manualRows 還原成一行一筆「email,姓名,連結」文字（沒有的欄位就不補逗號，
  // 免得下次存檔多出一堆空欄位）
  const manualRows = Array.isArray(record.manualRows)
    ? (record.manualRows as { email: string; name?: string; link?: string }[])
    : [];
  // isEnded 判定與 /admin/broadcast、/admin/sms 一致
  const nowTs = new Date();
  const webinarOptions = webinars
    .map((w) => ({
      id: w.id,
      title: w.title,
      requestCount: w.requests.length,
      withEmailCount: w.requests.filter((r) => !!r.email?.trim()).length,
      isEnded:
        !w.isActive ||
        hasEndedInTaipei(w.endDate) ||
        (!!w.unpublishAt && w.unpublishAt <= nowTs),
      endedAt: (w.endDate ?? w.unpublishAt)?.toISOString() ?? null,
    }))
    .sort((a, b) => Number(a.isEnded) - Number(b.isEnded));

  const defaults: BroadcastFormDefaults = {
    subject: record.subject,
    body: record.body,
    courseId: record.courseId ?? "",
    audience:
      record.audienceType === "GROUP"
        ? "group"
        : record.audienceType === "SESSION"
          ? "session"
          : record.audienceType === "WEBINAR"
            ? "webinar"
            : record.audienceType === "MANUAL"
              ? "manual"
              : "all",
    groupIds: broadcastGroupIds(record), // 改版前的單選紀錄會回填成一個勾選
    sessionIds: broadcastSessionIds(record),
    webinarIds: broadcastWebinarIds(record),
    isNotice: record.messageType === "NOTICE",
    manualList: manualRows
      .map((r) => [r.email, r.name, r.link].filter(Boolean).join(","))
      .join("\n"),
    scheduledAt: toDatetimeLocal(record.scheduledAt),
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/broadcast"
        className="text-sm text-indigo-600 hover:underline"
      >
        ← 回 Email群發
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        編輯{record.status === "DRAFT" ? "草稿" : "排程"}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        修改後可存回草稿、重新排程或立即寄出；若排程在編輯期間已到點寄出，送出時會提示。
      </p>
      <BroadcastForm
        courses={courses}
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g._count.members,
        }))}
        sessions={sessions.map((s) => ({
          id: s.id,
          title: s.title,
          signupCount: s._count.signups,
        }))}
        webinars={webinarOptions}
        marketingPages={marketingPages}
        memberCount={memberCount}
        members={profiles
          .filter((p) => p.email)
          .map((p) => ({
            email: p.email!,
            name: p.display_name ?? p.nickname ?? "",
          }))}
        sendAction={updateBroadcastAction.bind(null, id)}
        defaultValues={defaults}
        followUp={followUp}
      />
    </div>
  );
}
