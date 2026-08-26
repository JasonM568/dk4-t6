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
import { broadcastGroupIds, broadcastSessionIds } from "@/lib/email/audience";

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

  const [courses, memberCount, groups, sessions, profiles] = await Promise.all([
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
    listProfiles(),
  ]);

  // 跟進信：來源與條件唯讀（要換條件請取消排程後從來源明細頁重建）
  const followUp =
    record.audienceType === "FOLLOWUP" &&
    record.sourceBroadcastId &&
    record.followUpFilter &&
    isFollowUpFilter(record.followUpFilter)
      ? await buildFollowUpProp(record.sourceBroadcastId, record.followUpFilter)
      : undefined;

  // manualRows 還原成一行一筆「email,姓名」文字
  const manualRows = Array.isArray(record.manualRows)
    ? (record.manualRows as { email: string; name?: string }[])
    : [];
  const defaults: BroadcastFormDefaults = {
    subject: record.subject,
    body: record.body,
    courseId: record.courseId ?? "",
    audience:
      record.audienceType === "GROUP"
        ? "group"
        : record.audienceType === "SESSION"
          ? "session"
          : record.audienceType === "MANUAL"
            ? "manual"
            : "all",
    groupIds: broadcastGroupIds(record), // 改版前的單選紀錄會回填成一個勾選
    sessionIds: broadcastSessionIds(record),
    manualList: manualRows
      .map((r) => (r.name ? `${r.email},${r.name}` : r.email))
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
