import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentCanEdit } from "@/lib/auth/staff";
import { CreateWebinarForm } from "../webinars-manager";

export const metadata = { title: "建立講座 — 管理後台" };

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
      <h1 className="mb-1 text-2xl font-bold">建立講座</h1>
      <p className="mb-6 text-sm text-gray-500">
        建立後訪客即可到 /webinar/網址代稱 留姓名＋email 索取講座連結信；
        建好的講座到{" "}
        <Link href="/admin/webinars" className="text-indigo-600 underline">
          查看講座場次
        </Link>{" "}
        管理與看索取名單。
      </p>

      <section className="rounded-xl border border-gray-200 p-4">
        <CreateWebinarForm groups={mailGroups} />
      </section>
    </div>
  );
}
