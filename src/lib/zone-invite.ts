import "server-only";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/course-access";

// 邀請碼驗證與兌換：registerAction（帶碼註冊）與 redeemInviteAction（既有帳號輸碼）共用。

export type ValidInvite = {
  id: string;
  code: string;
  groupId: string;
  groupName: string;
};

/** 驗證邀請碼：存在 && 啟用中 && 未過期 && 所屬專區啟用中 */
export async function validateInviteCode(
  raw: string,
): Promise<{ ok: true; invite: ValidInvite } | { ok: false; error: string }> {
  const code = raw.trim().toUpperCase();
  if (!code) return { ok: false, error: "請輸入邀請碼" };

  const invite = await prisma.groupInviteCode.findUnique({
    where: { code },
    include: { group: { select: { id: true, name: true, isActive: true } } },
  });
  if (!invite || !invite.isActive || !invite.group.isActive) {
    return { ok: false, error: "邀請碼無效或已停用，請與發放單位確認" };
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { ok: false, error: "邀請碼已過期，請與發放單位確認" };
  }
  return {
    ok: true,
    invite: {
      id: invite.id,
      code: invite.code,
      groupId: invite.group.id,
      groupName: invite.group.name,
    },
  };
}

/** 兌換邀請碼：寫入專區會籍（冪等）＋ usedCount 累計 */
export async function redeemInvite(
  invite: ValidInvite,
  email: string,
  opts: { name?: string | null; userId?: string | null } = {},
): Promise<void> {
  await prisma.$transaction([
    prisma.courseGroupMember.upsert({
      where: {
        groupId_email: { groupId: invite.groupId, email: normalizeEmail(email) },
      },
      update: {},
      create: {
        groupId: invite.groupId,
        email: normalizeEmail(email),
        name: opts.name ?? null,
        userId: opts.userId ?? null,
        source: "INVITE",
        addedBy: invite.code,
      },
    }),
    prisma.groupInviteCode.update({
      where: { id: invite.id },
      data: { usedCount: { increment: 1 } },
    }),
  ]);
}
