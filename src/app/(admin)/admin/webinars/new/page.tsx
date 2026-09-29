import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { CreateWebinarForm } from "../webinars-manager";

export const metadata = { title: "建立名單收集頁 — 管理後台" };

export default async function NewWebinarPage() {
  // 建立為編輯/操作類，總教練（唯讀）導回列表頁
  const canEditNow = await currentCanEdit();
  if (!canEditNow) redirect("/admin/webinars");

  const mailGroups = await prisma.mailGroup.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">建立名單收集頁</h1>
      <p className="mb-6 text-sm text-gray-500">
        線上講座寄會議連結；素材索取寄影片、講義或檔案。建立後訪客到 /webinar/網址代稱
        留姓名、Email、手機（可加問卷）即自動收到信；建好的頁面到{" "}
        <Link href="/admin/webinars" className="text-indigo-600 underline">
          名單收集
        </Link>{" "}
        管理與看索取名單。
      </p>

      <section className="rounded-xl border border-gray-200 p-4">
        <CreateWebinarForm groups={mailGroups} />
      </section>
    </div>
  );
}
