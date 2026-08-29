"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { getAuthUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/admin";

export type MemberArchiveState = { error?: string; success?: string } | null;

function refresh(userId: string) {
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
}

export async function archiveMemberAction(
  userId: string,
  _previous: MemberArchiveState,
  fd: FormData,
): Promise<MemberArchiveState> {
  void _previous;
  await requireFullAdmin();
  const actor = await getAuthUser();
  if (!actor) return { error: "登入狀態已失效，請重新登入" };
  if (actor.id === userId) return { error: "不能封存自己的管理員帳號" };
  const profile = await getProfile(userId);
  if (!profile) return { error: "查無這個會員帳號" };
  if (profile.role === "admin") return { error: "不能封存管理員帳號" };
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 2) return { error: "請填寫封存原因" };

  await prisma.$transaction([
    prisma.memberArchive.upsert({
      where: { userId },
      update: { reason, archivedBy: actor.email ?? null, archivedAt: new Date() },
      create: { userId, reason, archivedBy: actor.email ?? null },
    }),
    prisma.adminAuditLog.create({
      data: {
        action: "MEMBER_ARCHIVE",
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        targetId: userId,
        success: true,
        detail: reason,
      },
    }),
  ]);
  refresh(userId);
  return { success: "會員已封存；帳號、訂單與觀看權限均未刪除" };
}

export async function restoreMemberAction(
  userId: string,
  _previous: MemberArchiveState,
): Promise<MemberArchiveState> {
  void _previous;
  await requireFullAdmin();
  const actor = await getAuthUser();
  if (!actor) return { error: "登入狀態已失效，請重新登入" };
  const archive = await prisma.memberArchive.findUnique({ where: { userId } });
  if (!archive) return { success: "這位會員目前沒有被封存" };

  await prisma.$transaction([
    prisma.memberArchive.delete({ where: { userId } }),
    prisma.adminAuditLog.create({
      data: {
        action: "MEMBER_RESTORE",
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        targetId: userId,
        success: true,
        detail: archive.reason ? `解除封存；原原因：${archive.reason}` : "解除封存",
      },
    }),
  ]);
  refresh(userId);
  return { success: "會員已解除封存，重新顯示於一般會員列表" };
}
