import "server-only";

import { prisma } from "@/lib/db";
import {
  FOLLOWUP_FILTER_LABEL,
  resolveFollowUpEmails,
  type FollowUpFilter,
} from "@/lib/email/followup";
import type { BroadcastFollowUp } from "./broadcast-form";

/** 組表單的跟進信 prop：查來源主旨＋估算目前符合條件人數（實際名單以寄出當下為準） */
export async function buildFollowUpProp(
  sourceId: string,
  filter: FollowUpFilter,
): Promise<BroadcastFollowUp> {
  const [source, events, recipientResults] = await Promise.all([
    prisma.emailBroadcast.findUnique({
      where: { id: sourceId },
      select: { subject: true, recipients: true },
    }),
    prisma.broadcastEvent.findMany({
      where: {
        broadcastId: sourceId,
        type: { in: ["OPENED", "CLICKED", "BOUNCED"] },
      },
      select: { email: true, type: true },
    }),
    prisma.emailBroadcastRecipient.findMany({
      where: { broadcastId: sourceId },
      select: { email: true, status: true },
    }),
  ]);
  const acceptedEmails =
    recipientResults.length > 0
      ? recipientResults.filter((r) => r.status === "ACCEPTED").map((r) => r.email)
      : (source?.recipients ?? []);
  const estimatedCount = resolveFollowUpEmails(filter, acceptedEmails, events).length;
  return {
    sourceId,
    sourceSubject: source?.subject ?? "（來源已不存在）",
    filter,
    filterLabel: FOLLOWUP_FILTER_LABEL[filter],
    estimatedCount,
  };
}
