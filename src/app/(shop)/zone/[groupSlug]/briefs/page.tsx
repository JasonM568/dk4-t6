import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/server";
import { currentStaffRole } from "@/lib/auth/staff";
import { canAccessAdmin } from "@/lib/auth/role";
import { isGroupMember } from "@/lib/course-access";

export const dynamic = "force-dynamic";

const coverClasses = [
  "from-slate-950 via-slate-800 to-indigo-900",
  "from-emerald-950 via-teal-800 to-cyan-700",
  "from-amber-950 via-orange-800 to-rose-700",
];

export default async function SubscriptionBriefsPage({ params }: { params: Promise<{ groupSlug: string }> }) {
  const { groupSlug } = await params;
  const zone = await prisma.courseGroup.findFirst({ where: { slug: groupSlug, kind: "SUBSCRIPTION", isActive: true } });
  if (!zone) notFound();
  const user = await getAuthUser();
  const [member, role] = await Promise.all([isGroupMember(zone.id, user?.email), currentStaffRole()]);
  if (!member && !canAccessAdmin(role)) {
    return <main className="mx-auto flex max-w-xl flex-1 items-center px-4 py-20 text-center"><div className="w-full rounded-2xl border border-gray-200 p-8"><div className="text-3xl">🔒</div><h1 className="mt-3 text-2xl font-bold">每日財經剪報</h1><p className="mt-2 text-sm text-gray-500">此內容僅開放給訂閱會員。登入後仍無法觀看，請聯絡客服確認訂閱資格。</p><Link href={`/zone/${zone.slug}`} className="mt-5 inline-block text-sm text-indigo-600 underline">回到訂閱專區</Link></div></main>;
  }
  const briefs = await prisma.dailyBrief.findMany({ where: { groupId: zone.id, status: "PUBLISHED" }, include: { images: { orderBy: { sortOrder: "asc" } } }, orderBy: { dateKey: "desc" } });
  return <main className="mx-auto max-w-5xl flex-1 px-4 py-10"><Link href={`/zone/${zone.slug}`} className="text-sm text-indigo-600 hover:underline">← {zone.name}</Link><h1 className="mt-3 text-3xl font-bold">每日財經剪報</h1><p className="mt-2 text-sm text-gray-500">每日精選財經新聞，依日期保存閱讀。</p><div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{briefs.map((brief) => <article key={brief.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"><div className={`bg-gradient-to-br ${coverClasses[brief.coverVariant % 3]} p-5 text-white`}><p className="text-xs tracking-widest text-white/70">HOPE ACADEMY · FINANCE BRIEF</p><h2 className="mt-12 text-xl font-bold">每日財經剪報</h2><p className="mt-1 text-sm text-white/85">{brief.dateKey.replaceAll("-", ".")}</p></div><div className="p-4"><h2 className="font-medium">{brief.title}</h2><p className="mt-1 text-xs text-gray-400">{brief.images.length} 則新聞剪報</p><div className="mt-3 space-y-3">{brief.images.map((image, index) => <img key={image.id} src={image.imageUrl} alt={`${brief.title} 第 ${index + 1} 則`} className="w-full rounded-lg border border-gray-100" />)}</div></div></article>)}{!briefs.length && <p className="text-sm text-gray-400">剪報籌備中，敬請期待。</p>}</div></main>;
}
