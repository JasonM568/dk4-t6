import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { INQUIRY_STATUSES } from "@/lib/corporate";
import { InquiriesManager, NotifyEmailForm } from "./inquiries-manager";

export const metadata = { title: "企業包班諮詢 — 管理後台" };

export default async function AdminCorporatePage() {
  const [inquiries, notifySetting, canEditNow] = await Promise.all([
    prisma.corporateInquiry.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.siteSetting.findUnique({ where: { key: "corporateNotifyEmail" } }),
    currentCanEdit(),
  ]);

  const newCount = inquiries.filter((i) => i.status === "NEW").length;

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="mb-1 text-2xl font-bold">
          企業包班諮詢
          <span className="ml-2 text-base font-normal text-gray-400">
            共 {inquiries.length} 筆{newCount > 0 && `・${newCount} 筆新進`}
          </span>
        </h1>
        <p className="text-sm text-gray-500">
          企業到 /corporate 留下包班需求後會出現在這裡；新單會寄通知信到下方設定的信箱。
        </p>
      </header>

      {canEditNow && (
        <NotifyEmailForm initialEmail={notifySetting?.value ?? ""} />
      )}

      <InquiriesManager
        canEdit={canEditNow}
        inquiries={inquiries.map((i) => ({
          id: i.id,
          companyName: i.companyName,
          contactName: i.contactName,
          contactTitle: i.contactTitle,
          email: i.email,
          phone: i.phone,
          headcount: i.headcount,
          topics: i.topics,
          trainingType: i.trainingType,
          preferredTime: i.preferredTime,
          budget: i.budget,
          message: i.message,
          status: i.status as (typeof INQUIRY_STATUSES)[number]["value"] | string,
          adminNote: i.adminNote,
          createdAt: i.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
