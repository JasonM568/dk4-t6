import { prisma } from "@/lib/db";
import { EnrollForm } from "./enroll-form";

export const metadata = { title: "批次開通 — 管理後台" };

import { pageGuardEditor } from "@/lib/auth/staff";
export default async function EnrollmentsPage() {
  await pageGuardEditor();
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">批次開通觀看權限</h1>
      <p className="mt-2 text-sm text-gray-500">
        為已是會員的學員批次開通課程影片觀看權限（建立 Enrollment）。
        開通後學員登入即可在「我的課程」看到該課程。
      </p>
      <EnrollForm courses={courses} />
    </div>
  );
}
