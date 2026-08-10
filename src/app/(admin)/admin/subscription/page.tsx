import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { toggleZoneActive } from "@/actions/admin";
import { ZoneCreateForm } from "../zones/zone-create-form";

export const metadata = { title: "訂閱專區 — 管理後台" };

/** 訂閱會員影片專區：資格以 CourseGroupMember 名單管理；課程放入本專區即供名單會員觀看。 */
export default async function AdminSubscriptionPage() {
  await pageGuardEditor();
  const zones = await prisma.courseGroup.findMany({
    where: { kind: "SUBSCRIPTION" },
    include: { _count: { select: { members: true, courses: true } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">訂閱專區</h1>
      <p className="mb-6 text-sm text-gray-500">
        將線上講座影片設為此專區的課程後，列在訂閱會員名單中的會員即可觀看；移出名單會立即停止觀看資格。
      </p>
      <ul className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {zones.length === 0 && <li className="px-4 py-4 text-sm text-gray-400">尚無訂閱專區，先在下方建立</li>}
        {zones.map((z) => (
          <li key={z.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <Link href={`/admin/zones/${z.id}`} className="font-medium hover:underline">{z.name}</Link>
              <span className="ml-2 font-mono text-xs text-gray-400">/zone/{z.slug}</span>
              <div className="mt-0.5 text-xs text-gray-400">{z._count.members} 位訂閱會員 · {z._count.courses} 部影片課程</div>
            </div>
            <form action={toggleZoneActive.bind(null, z.id, !z.isActive)}>
              <button className="text-sm text-indigo-600 hover:underline">{z.isActive ? "停用" : "啟用"}</button>
            </form>
            <Link href={`/admin/zones/${z.id}`} className="text-sm text-indigo-600 hover:underline">管理</Link>
          </li>
        ))}
      </ul>
      <ZoneCreateForm subscription />
    </div>
  );
}
