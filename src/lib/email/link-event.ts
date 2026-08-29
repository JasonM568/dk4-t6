import "server-only";

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function recordBroadcastLinkClick(input: {
  svixId: string;
  eventType: string;
  broadcastId: string;
  email: string;
  link: unknown;
  timestamp: unknown;
}): Promise<"recorded" | "duplicate" | "invalid"> {
  if (typeof input.link !== "string" || input.link.length > 4096) return "invalid";
  let clickUrl: string;
  try {
    const parsed = new URL(input.link);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid";
    clickUrl = parsed.toString();
  } catch {
    return "invalid";
  }
  const urlHash = crypto.createHash("sha256").update(clickUrl).digest("hex");
  const parsedTimestamp = typeof input.timestamp === "string" ? new Date(input.timestamp) : null;
  const clickedAt = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) ? parsedTimestamp : new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookReceipt.create({ data: { svixId: input.svixId, eventType: input.eventType } });
      await tx.broadcastLinkEvent.upsert({
        where: { broadcastId_email_urlHash: { broadcastId: input.broadcastId, email: input.email, urlHash } },
        create: { broadcastId: input.broadcastId, email: input.email, url: clickUrl, urlHash, firstClickedAt: clickedAt, lastClickedAt: clickedAt },
        update: { lastClickedAt: clickedAt, clickCount: { increment: 1 } },
      });
    });
    return "recorded";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}
