import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatNT } from "@/lib/format";

export const metadata = { title: "課程管理" };

export default async function AdminCoursesPage() {
  const courses = await prisma.course.findMany({
    include: { _count: { select: { lessons: true, enrollments: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">課程管理</h1>
        <Link
          href="/admin/courses/new"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
        >
          + 新增課程
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">標題</th>
              <th className="px-4 py-3">售價</th>
              <th className="px-4 py-3">章節</th>
              <th className="px-4 py-3">已售</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {courses.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{c.title}</div>
                  <div className="font-mono text-xs text-gray-400">{c.slug}</div>
                </td>
                <td className="px-4 py-3">{formatNT(c.price)}</td>
                <td className="px-4 py-3">{c._count.lessons}</td>
                <td className="px-4 py-3">{c._count.enrollments}</td>
                <td className="px-4 py-3">
                  {c.isPublished ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      已上架
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      未上架
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/courses/${c.id}`}
                    className="text-indigo-600 hover:underline"
                  >
                    編輯
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
