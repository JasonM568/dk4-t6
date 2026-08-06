import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { WebinarCard } from "./webinars-manager";

export const metadata = { title: "講座場次 — 管理後台" };

export default async function AdminWebinarsPage() {
  const [webinars, mailGroups, canEditNow] = await Promise.all([
    prisma.webinar.findMany({
      orderBy: { createdAt: "desc" },
      include: { requests: { orderBy: { createdAt: "desc" } } },
    }),
    prisma.mailGroup.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    currentCanEdit(),
  ]);

  return (
    <div className="max-w-4xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold">
            講座場次
            <span className="ml-2 text-base font-normal text-gray-400">
              共 {webinars.length} 場
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            點開場次管理設定與索取名單；訪客到 /webinar/網址代稱 留姓名＋email 即寄講座連結信。
          </p>
        </div>
        {canEditNow && (
          <Link
            href="/admin/webinars/new"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            ＋建立講座
          </Link>
        )}
      </header>

      <div className="space-y-3">
        {webinars.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            還沒有講座——到「建立講座」開第一場
          </p>
        )}
        {webinars.map((w) => (
          <WebinarCard
            key={w.id}
            canEdit={canEditNow}
            groups={mailGroups}
            webinar={{
              id: w.id,
              slug: w.slug,
              title: w.title,
              description: w.description,
              lectureUrl: w.lectureUrl,
              meetingId: w.meetingId,
              meetingPassword: w.meetingPassword,
              meetingInfo: w.meetingInfo,
              dmImage: w.dmImage,
              emailSubject: w.emailSubject,
              emailBody: w.emailBody,
              groupId: w.groupId,
              isActive: w.isActive,
              requests: w.requests.map((r) => ({
                id: r.id,
                email: r.email,
                name: r.name,
                sentCount: r.sentCount,
                lastSentAt: r.lastSentAt?.toISOString() ?? null,
                createdAt: r.createdAt.toISOString(),
                deliveryStatus: r.deliveryStatus,
                deliveryDetail: r.deliveryDetail,
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
