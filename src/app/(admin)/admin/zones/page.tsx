import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { prisma } from "@/lib/db";
import { toggleZoneActive } from "@/actions/admin";
import { ZoneCreateForm } from "./zone-create-form";

export const metadata = { title: "企業專區 — 管理後台" };

export default async function AdminZonesPage() {
  await pageGuardEditor();
  const zones = await prisma.courseGroup.findMany({
    include: {
      _count: { select: { members: true, courses: true, inviteCodes: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">企業專區</h1>
      <p className="mb-6 text-sm text-gray-500">
        企業包班專用分區（如世華會）。掛進專區的課程不會出現在一般課程列表、不可購買，
        只有專區會員看得到；<strong>觀看權限仍需逐課開通</strong>（用「
        <Link href="/admin/enrollments" className="font-medium text-indigo-600 underline">
          批次開通
        </Link>
        」）。
      </p>

      <ul className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {zones.length === 0 && (
          <li className="px-4 py-4 text-sm text-gray-400">
            尚無專區，先在下方建立
          </li>
        )}
        {zones.map((z) => (
          <li key={z.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <Link
                href={`/admin/zones/${z.id}`}
                className="font-medium hover:underline"
              >
                {z.name}
              </Link>
              <span className="ml-2 font-mono text-xs text-gray-400">
                /zone/{z.slug}
              </span>
              <div className="mt-0.5 text-xs text-gray-400">
                {z._count.members} 位會員 · {z._count.courses} 門課程 ·{" "}
                {z._count.inviteCodes} 組邀請碼
              </div>
            </div>
            {z.isActive ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                啟用中
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                已停用
              </span>
            )}
            <form action={toggleZoneActive.bind(null, z.id, !z.isActive)}>
              <button className="text-sm text-indigo-600 hover:underline">
                {z.isActive ? "停用" : "啟用"}
              </button>
            </form>
            <Link
              href={`/admin/zones/${z.id}`}
              className="text-sm text-indigo-600 hover:underline"
            >
              管理
            </Link>
          </li>
        ))}
      </ul>

      <ZoneCreateForm />
    </div>
  );
}
