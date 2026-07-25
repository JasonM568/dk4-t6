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

export const metadata = { title: "編輯群發 — Email群發" };

// 編輯頁可直接立即寄出（沿用本 segment 設定），數百封也要跑得完
export const maxDuration = 300;

/** Date → datetime-local 值（台北時間 YYYY-MM-DDTHH:mm）；sv-SE locale 天然輸出 ISO 樣式 */
function toDatetimeLocal(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(" ", "T");
}

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

  const [courses, memberCount, groups, profiles] = await Promise.all([
    prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, title: true },
    }),
    countProfiles(),
    prisma.mailGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    }),
    listProfiles(),
  ]);

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
        : record.audienceType === "MANUAL"
          ? "manual"
          : "all",
    groupId: record.groupId ?? "",
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
        memberCount={memberCount}
        members={profiles
          .filter((p) => p.email)
          .map((p) => ({
            email: p.email!,
            name: p.display_name ?? p.nickname ?? "",
          }))}
        sendAction={updateBroadcastAction.bind(null, id)}
        defaultValues={defaults}
      />
    </div>
  );
}
