"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { isPerformanceFilter, PERFORMANCE_FILTER_LABEL, resolvePerformanceEmails } from "@/lib/email/performance-segment";

export async function createPerformanceGroupAction(formData: FormData) {
  await requireEditor();
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const filter = String(formData.get("filter") ?? "");
  const groupName = String(formData.get("groupName") ?? "").trim();
  if (!broadcastId || !groupName || !isPerformanceFilter(filter)) throw new Error("成效名單條件不完整");
  const broadcast = await prisma.emailBroadcast.findUnique({ where: { id: broadcastId }, select: { status: true, recipients: true } });
  if (!broadcast || broadcast.status !== "SENT") throw new Error("只能從已寄出的 EDM 建立成效名單");
  const [recipientResults, events] = await Promise.all([
    prisma.emailBroadcastRecipient.findMany({ where: { broadcastId }, select: { email: true, name: true, status: true } }),
    prisma.broadcastEvent.findMany({ where: { broadcastId }, select: { email: true, type: true } }),
  ]);
  const accepted = recipientResults.length > 0
    ? recipientResults.filter((row) => row.status === "ACCEPTED").map((row) => row.email)
    : broadcast.recipients;
  const emails = resolvePerformanceEmails(filter, accepted, events);
  if (emails.length === 0) throw new Error(`目前沒有符合「${PERFORMANCE_FILTER_LABEL[filter]}」的收件人`);
  const nameByEmail = new Map(recipientResults.map((row) => [row.email, row.name]));
  const group = await prisma.mailGroup.upsert({ where: { name: groupName }, update: {}, create: { name: groupName } });
  await prisma.mailGroupMember.createMany({
    data: emails.map((email) => ({ groupId: group.id, email, name: nameByEmail.get(email) ?? null })),
    skipDuplicates: true,
  });
  redirect(`/admin/broadcast/groups/${group.id}`);
}
