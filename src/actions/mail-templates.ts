"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";

const back = (key: "ok" | "error", message: string) =>
  `/admin/broadcast/templates?${key}=${encodeURIComponent(message)}`;

export async function saveMailTemplateManagementAction(formData: FormData) {
  await requireEditor();
  const admin = await getAuthUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "") || null;
  const overwrite = formData.get("overwrite") === "on";
  if (!name || !subject || !body) redirect(back("error", "範本名稱、主旨與內文皆為必填"));

  const collision = await prisma.mailTemplate.findUnique({ where: { name } });
  if (collision && collision.id !== id && !overwrite) {
    redirect(back("error", `範本「${name}」已存在；若確定覆蓋，請勾選覆蓋確認`));
  }
  if (collision && collision.id !== id && overwrite) {
    await prisma.$transaction([
      ...(id ? [prisma.mailTemplate.deleteMany({ where: { id } })] : []),
      prisma.mailTemplate.update({
        where: { id: collision.id },
        data: { subject, body, courseId, createdBy: admin?.email ?? null },
      }),
    ]);
  } else if (id) {
    await prisma.mailTemplate.updateMany({
      where: { id },
      data: { name, subject, body, courseId, createdBy: admin?.email ?? null },
    });
  } else {
    await prisma.mailTemplate.create({
      data: { name, subject, body, courseId, createdBy: admin?.email ?? null },
    });
  }
  revalidatePath("/admin/broadcast");
  revalidatePath("/admin/broadcast/templates");
  redirect(back("ok", `已儲存範本「${name}」`));
}

export async function copyMailTemplateAction(id: string) {
  await requireEditor();
  const admin = await getAuthUser();
  const source = await prisma.mailTemplate.findUnique({ where: { id } });
  if (!source) redirect(back("error", "找不到來源範本"));
  let name = `${source.name}－副本`;
  let suffix = 2;
  while (await prisma.mailTemplate.findUnique({ where: { name }, select: { id: true } })) {
    name = `${source.name}－副本 ${suffix++}`;
  }
  await prisma.mailTemplate.create({
    data: {
      name,
      subject: source.subject,
      body: source.body,
      courseId: source.courseId,
      createdBy: admin?.email ?? null,
    },
  });
  revalidatePath("/admin/broadcast/templates");
  redirect(back("ok", `已複製為「${name}」`));
}

export async function deleteMailTemplateManagementAction(id: string) {
  await requireEditor();
  await prisma.mailTemplate.deleteMany({ where: { id } });
  revalidatePath("/admin/broadcast");
  revalidatePath("/admin/broadcast/templates");
  redirect(back("ok", "範本已刪除；歷史寄送不受影響"));
}
