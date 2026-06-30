import { prisma } from "@/lib/db";
import { EnrollForm } from "./enroll-form";

export const metadata = { title: "批次開通 — 管理後台" };

import { pageGuardEditor } from "@/lib/auth/staff";
export default async function EnrollmentsPage() {
  await pageGuardEditor();
  const [courses, mailGroups] = await Promise.all([
    prisma.course.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
    prisma.mailGroup.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">批次開通觀看權限</h1>
      <p className="mt-2 text-sm text-gray-500">
        貼一份名單就能<strong>一次完成</strong>：開通既有會員的課程影片觀看權限；
        名單裡查無的會員，填一組預設密碼就能<strong>直接建立帳號並開通</strong>；
        還可順便把整份名單加進<strong>寄信名單群組</strong>。開通後學員登入即可在「我的課程」看到該課程。
      </p>
      <EnrollForm courses={courses} mailGroups={mailGroups} />
    </div>
  );
}
