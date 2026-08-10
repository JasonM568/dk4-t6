import { notFound } from "next/navigation";
import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { DailyBriefsManager } from "./briefs-manager";

export const metadata = { title: "每日財經剪報 — 管理後台" };
export const dynamic = "force-dynamic";

export default async function AdminDailyBriefsPage({ params }: { params: Promise<{ groupSlug: string }> }) {
  await pageGuardEditor();
  const { groupSlug } = await params;
  const group = await prisma.courseGroup.findFirst({
    where: { slug: groupSlug, kind: "SUBSCRIPTION" },
    include: { dailyBriefs: { include: { images: { orderBy: { sortOrder: "asc" } } }, orderBy: { dateKey: "desc" } } },
  });
  if (!group) notFound();
  return (
    <div className="max-w-3xl">
      <Link href="/admin/subscription" className="text-sm text-indigo-600 hover:underline">← 訂閱專區</Link>
      <h1 className="mt-3 text-2xl font-bold">{group.name}｜每日財經剪報</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        上傳當日新聞截圖即可立即發布；標題、日期與三款封面由系統自動處理。可在下方補圖、排序及下架。
      </p>
      <DailyBriefsManager groupId={group.id} groupSlug={group.slug} briefs={group.dailyBriefs.map((brief) => ({
        id: brief.id, dateKey: brief.dateKey, title: brief.title, status: brief.status, coverVariant: brief.coverVariant,
        images: brief.images.map((image) => image.imageUrl),
      }))} />
    </div>
  );
}
