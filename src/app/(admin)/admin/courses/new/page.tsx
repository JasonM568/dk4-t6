import Link from "next/link";
import { prisma } from "@/lib/db";
import { createCourse } from "@/actions/admin";
import { CourseForm } from "@/components/course-form";

export const metadata = { title: "新增課程" };

import { pageGuardEditor } from "@/lib/auth/staff";
export default async function NewCoursePage() {
  await pageGuardEditor();
  const categories = await prisma.category.findMany({
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
      <h1 className="mb-6 mt-2 text-2xl font-bold">新增課程</h1>
      <CourseForm action={createCourse} allCategories={categories} submitLabel="建立課程" />
    </div>
  );
}
