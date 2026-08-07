import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasEndedInTaipei } from "@/lib/board-expiry";
import { WebinarRequestForm } from "./request-form";

// 結束日過了要即時顯示「已結束」——過期是時間觸發，沒有 admin 動作可 revalidate，
// 一律動態渲染（報名頁流量低，成本可忽略）
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const webinar = await prisma.webinar.findUnique({
    where: { slug },
    select: { title: true },
  });
  return { title: webinar ? `${webinar.title} — 講座報名` : "講座報名" };
}

export default async function WebinarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { slug } });
  if (!webinar) notFound();

  // 寄件者顯示給訪客「加入通訊錄」用；EMAIL_FROM 格式可能是 "名稱 <a@b>"，取角括號內
  const from = process.env.EMAIL_FROM ?? "course@huangxi.info";
  const senderEmail = from.match(/<([^>]+)>/)?.[1] ?? from;

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-gray-200 p-6 sm:p-8">
        {webinar.dmImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={webinar.dmImage}
            alt={`${webinar.title} 講座 DM`}
            className="mb-5 w-full rounded-xl"
          />
        )}
        <h1 className="mb-3 text-2xl font-bold">{webinar.title}</h1>
        {webinar.description && (
          <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {webinar.description}
          </p>
        )}
        {webinar.isActive && !hasEndedInTaipei(webinar.endDate) ? (
          <WebinarRequestForm slug={slug} senderEmail={senderEmail} />
        ) : (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-gray-500">
            此講座報名已結束
          </p>
        )}
      </div>
    </main>
  );
}
