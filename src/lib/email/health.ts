import "server-only";

import { prisma } from "@/lib/db";

export const HEALTH_FILTERS = ["ALL", "USER", "BOUNCE", "COMPLAINT", "PENDING", "INACTIVE"] as const;
export type HealthFilter = (typeof HEALTH_FILTERS)[number];
export type HealthRow = {
  email: string;
  status: Exclude<HealthFilter, "ALL">;
  reason: string | null;
  occurredAt: Date;
};

export function parseHealthFilter(value: string | undefined): HealthFilter {
  return HEALTH_FILTERS.includes(value as HealthFilter) ? (value as HealthFilter) : "ALL";
}

export async function getMailHealth(filter: HealthFilter, query: string) {
  const now = Date.now();
  const pendingBefore = new Date(now - 15 * 60 * 1000);
  const activeSince = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const q = query.trim().toLowerCase().slice(0, 200);

  const [unsubGroups, pendingCount, recentAccepted, recentClicked] = await Promise.all([
    prisma.mailUnsubscribe.groupBy({ by: ["source"], _count: true }),
    prisma.emailBroadcastRecipient.count({
      where: { status: "PENDING", updatedAt: { lt: pendingBefore } },
    }),
    prisma.emailBroadcastRecipient.findMany({
      where: { status: "ACCEPTED", createdAt: { gte: activeSince } },
      distinct: ["email"],
      select: { email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.broadcastEvent.findMany({
      where: { type: "CLICKED", createdAt: { gte: activeSince } },
      distinct: ["email"],
      select: { email: true },
    }),
  ]);
  const clicked = new Set(recentClicked.map((row) => row.email));
  const inactive = recentAccepted.filter((row) => !clicked.has(row.email));
  const count = (source: string) => unsubGroups.find((row) => row.source === source)?._count ?? 0;

  let rows: HealthRow[] = [];
  if (filter === "PENDING") {
    const found = await prisma.emailBroadcastRecipient.findMany({
      where: {
        status: "PENDING",
        updatedAt: { lt: pendingBefore },
        ...(q ? { email: { contains: q, mode: "insensitive" } } : {}),
      },
      distinct: ["email"],
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { email: true, updatedAt: true },
    });
    rows = found.map((row) => ({ email: row.email, status: "PENDING", reason: "Provider 結果未完成回寫；系統不會自動重寄", occurredAt: row.updatedAt }));
  } else if (filter === "INACTIVE") {
    rows = inactive
      .filter((row) => !q || row.email.includes(q))
      .slice(0, 500)
      .map((row) => ({ email: row.email, status: "INACTIVE", reason: "最近 90 天曾接受寄送，但沒有點擊事件", occurredAt: row.createdAt }));
  } else {
    const found = await prisma.mailUnsubscribe.findMany({
      where: {
        ...(filter === "ALL" ? {} : { source: filter }),
        ...(q ? { email: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    rows = found.map((row) => ({
      email: row.email,
      status: row.source as "USER" | "BOUNCE" | "COMPLAINT",
      reason: row.reason,
      occurredAt: row.createdAt,
    }));
  }
  return {
    counts: {
      USER: count("USER"),
      BOUNCE: count("BOUNCE"),
      COMPLAINT: count("COMPLAINT"),
      PENDING: pendingCount,
      INACTIVE: inactive.length,
    },
    rows,
  };
}
