import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  updateCourse,
  deleteCourse,
  addLesson,
  updateLesson,
  deleteLesson,
  addMaterialAction,
  deleteMaterial,
} from "@/actions/admin";
import { CourseForm } from "@/components/course-form";
import { pageGuardEditor } from "@/lib/auth/staff";
import { LessonRow } from "./lesson-row";
import { MaterialsSection } from "./materials-section";

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await pageGuardEditor(); // 總教練(唯讀)不可進編輯頁
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      lessons: { orderBy: { order: "asc" } },
      materials: { orderBy: { createdAt: "asc" } },
      categories: { select: { id: true } },
    },
  });
  if (!course) notFound();

  const allCategories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  return (
    <div>
      <Link
        href="/admin/courses"
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 課程管理
      </Link>
      <div className="mb-6 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">編輯課程</h1>
        <Link
          href={`/admin/courses/${course.id}/members`}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
        >
          👥 觀看權限名單
        </Link>
      </div>

      <CourseForm
        action={updateCourse.bind(null, course.id)}
        defaultValues={{
          ...course,
          categoryIds: course.categories.map((c) => c.id),
        }}
        allCategories={allCategories}
        submitLabel="儲存變更"
      />

      {/* 章節管理 */}
      <div className="mt-10 max-w-2xl">
        <h2 className="mb-3 text-lg font-bold">章節管理</h2>
        <ul className="mb-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {course.lessons.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">尚無章節</li>
          )}
          {course.lessons.map((l) => (
            <LessonRow
              key={l.id}
              lesson={l}
              updateAction={updateLesson.bind(null, l.id, course.id)}
              deleteAction={deleteLesson.bind(null, l.id, course.id)}
            />
          ))}
        </ul>

        <form
          action={addLesson.bind(null, course.id)}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-gray-300 p-4"
        >
          <div>
            <label className="mb-1 block text-xs text-gray-500">章節標題</label>
            <input
              name="title"
              required
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              YouTube 網址或影片 ID
            </label>
            <input
              name="youtubeId"
              required
              placeholder="可直接貼影片網址或嵌入碼"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="w-16">
            <label className="mb-1 block text-xs text-gray-500">順序</label>
            <input
              name="order"
              type="number"
              defaultValue={course.lessons.length + 1}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs text-gray-500">秒數</label>
            <input
              name="durationSec"
              type="number"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="w-full">
            <label className="mb-1 block text-xs text-gray-500">
              線上簡報網址（選填，貼 Google Slides / Canva 分享連結即可）
            </label>
            <input
              name="slideUrl"
              type="url"
              placeholder="https://docs.google.com/presentation/…"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            新增章節
          </button>
        </form>
      </div>

      {/* 講義管理 */}
      <MaterialsSection
        materials={course.materials}
        addAction={addMaterialAction.bind(null, course.id)}
        deleteActions={Object.fromEntries(
          course.materials.map((m) => [
            m.id,
            deleteMaterial.bind(null, m.id, course.id),
          ]),
        )}
      />

      {/* 危險操作 */}
      <div className="mt-10 max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4">
        <h2 className="font-bold text-red-700">刪除課程</h2>
        <p className="mt-1 text-sm text-red-600">
          將一併刪除章節，已售出的訂單明細會保留。此動作無法復原。
        </p>
        <form action={deleteCourse.bind(null, course.id)} className="mt-3">
          <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white">
            刪除此課程
          </button>
        </form>
      </div>
    </div>
  );
}
