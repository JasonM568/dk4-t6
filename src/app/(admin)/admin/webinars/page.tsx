import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { CreateWebinarForm, WebinarCard } from "./webinars-manager";

export const metadata = { title: "講座報名頁 — 管理後台" };

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
      <h1 className="mb-1 text-2xl font-bold">講座報名頁</h1>
      <p className="mb-6 text-sm text-gray-500">
        訪客到報名頁輸入 email → 系統寄含講座連結的信，並自動加入指定名單群組。
        寄信走 huangxi.info 認證網域（SPF/DKIM/DMARC），成功頁附找信與加通訊錄指引。
      </p>

      {canEditNow && (
        <section className="mb-6 rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-medium">建立講座頁</h2>
          <CreateWebinarForm groups={mailGroups} />
        </section>
      )}

      <div className="space-y-3">
        {webinars.length === 0 && (
          <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            還沒有講座頁
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
                sentCount: r.sentCount,
                lastSentAt: r.lastSentAt?.toISOString() ?? null,
                createdAt: r.createdAt.toISOString(),
              })),
            }}
          />
        ))}
      </div>
    </div>
  );
}
