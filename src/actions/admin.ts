"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("需要管理員權限");
  }
}

const courseSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug 只能用小寫英數與連字號"),
  title: z.string().min(1),
  description: z.string().min(1),
  coverImage: z.string().url().or(z.literal("")),
  price: z.coerce.number().int().min(0),
  isPublished: z.coerce.boolean(),
});

export async function createCourse(formData: FormData) {
  await requireAdmin();
  const data = courseSchema.parse({
    slug: formData.get("slug"),
    title: formData.get("title"),
    description: formData.get("description"),
    coverImage: formData.get("coverImage"),
    price: formData.get("price"),
    isPublished: formData.get("isPublished") === "on",
  });
  await prisma.course.create({ data });
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function updateCourse(id: string, formData: FormData) {
  await requireAdmin();
  const data = courseSchema.parse({
    slug: formData.get("slug"),
    title: formData.get("title"),
    description: formData.get("description"),
    coverImage: formData.get("coverImage"),
    price: formData.get("price"),
    isPublished: formData.get("isPublished") === "on",
  });
  await prisma.course.update({ where: { id }, data });
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
  redirect("/admin/courses");
}

export async function deleteCourse(id: string) {
  await requireAdmin();
  await prisma.course.delete({ where: { id } });
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function addLesson(courseId: string, formData: FormData) {
  await requireAdmin();
  const title = String(formData.get("title") ?? "");
  const youtubeId = String(formData.get("youtubeId") ?? "");
  const order = Number(formData.get("order") ?? 0);
  const durationSec = formData.get("durationSec")
    ? Number(formData.get("durationSec"))
    : null;
  if (!title || !youtubeId) return;
  await prisma.lesson.create({
    data: { courseId, title, youtubeId, order, durationSec },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function deleteLesson(lessonId: string, courseId: string) {
  await requireAdmin();
  await prisma.lesson.delete({ where: { id: lessonId } });
  revalidatePath(`/admin/courses/${courseId}`);
}

const tierSchema = z.object({
  minTotalSpent: z.coerce.number().int().min(0),
  discountPercent: z.coerce.number().int().min(0).max(100),
});

export async function updateTier(id: string, formData: FormData) {
  await requireAdmin();
  const data = tierSchema.parse({
    minTotalSpent: formData.get("minTotalSpent"),
    discountPercent: formData.get("discountPercent"),
  });
  await prisma.membershipTier.update({ where: { id }, data });
  revalidatePath("/admin/members");
}
