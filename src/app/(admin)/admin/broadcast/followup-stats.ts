import "server-only";

import { prisma } from "@/lib/db";
import {
  FOLLOWUP_FILTER_LABEL,
  type FollowUpFilter,
} from "@/lib/email/followup";
import type { BroadcastFollowUp } from "./broadcast-form";

/** 組表單的跟進信 prop：查來源主旨＋估算目前符合條件人數（實際名單以寄出當下為準） */
export async function buildFollowUpProp(
  sourceId: string,
  filter: FollowUpFilter,
): Promise<BroadcastFollowUp> {
  const [source, events] = await Promise.all([
    prisma.emailBroadcast.findUnique({
      where: { id: sourceId },
      select: { subject: true, recipients: true },
    }),
    prisma.broadcastEvent.groupBy({
      by: ["type"],
      where: {
        broadcastId: sourceId,
        type: { in: ["OPENED", "CLICKED", "BOUNCED"] },
      },
      _count: true,
    }),
  ]);
  const count = (t: string) => events.find((e) => e.type === t)?._count ?? 0;
  const estimatedCount =
    filter === "OPENED"
      ? count("OPENED")
      : filter === "CLICKED"
        ? count("CLICKED")
        : Math.max(
            0,
            (source?.recipients.length ?? 0) - count("OPENED") - count("BOUNCED"),
          );
  return {
    sourceId,
    sourceSubject: source?.subject ?? "（來源已不存在）",
    filter,
    filterLabel: FOLLOWUP_FILTER_LABEL[filter],
    estimatedCount,
  };
}
