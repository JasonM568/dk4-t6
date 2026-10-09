import "server-only";

import { prisma } from "@/lib/db";

/** 原子預約一次登入嘗試；同一個 key 的併發請求由 UPSERT 序列化。 */
export async function reserveLoginAttempt(
  key: string,
  windowMs: number,
  maxFails: number,
  lockMs: number,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ failCount: number; lockedUntil: Date | null }[]>`
    INSERT INTO "course"."BoardLoginThrottle"
      ("key", "failCount", "windowStart", "lockedUntil", "updatedAt")
    VALUES (${key}, 1, timezone('UTC', now()), NULL, timezone('UTC', now()))
    ON CONFLICT ("key") DO UPDATE SET
      "failCount" = CASE
        WHEN ("BoardLoginThrottle"."lockedUntil" IS NOT NULL AND "BoardLoginThrottle"."lockedUntil" <= timezone('UTC', now()))
          OR timezone('UTC', now()) - "BoardLoginThrottle"."windowStart" > (${windowMs}::int * interval '1 millisecond')
          THEN 1
        ELSE "BoardLoginThrottle"."failCount" + 1
      END,
      "windowStart" = CASE
        WHEN ("BoardLoginThrottle"."lockedUntil" IS NOT NULL AND "BoardLoginThrottle"."lockedUntil" <= timezone('UTC', now()))
          OR timezone('UTC', now()) - "BoardLoginThrottle"."windowStart" > (${windowMs}::int * interval '1 millisecond')
          THEN timezone('UTC', now())
        ELSE "BoardLoginThrottle"."windowStart"
      END,
      "lockedUntil" = CASE
        WHEN "BoardLoginThrottle"."lockedUntil" > timezone('UTC', now())
          THEN "BoardLoginThrottle"."lockedUntil"
        WHEN ("BoardLoginThrottle"."lockedUntil" IS NOT NULL AND "BoardLoginThrottle"."lockedUntil" <= timezone('UTC', now()))
          OR timezone('UTC', now()) - "BoardLoginThrottle"."windowStart" > (${windowMs}::int * interval '1 millisecond')
          THEN NULL
        ELSE "BoardLoginThrottle"."lockedUntil"
      END,
      "updatedAt" = timezone('UTC', now())
    RETURNING "failCount", "lockedUntil"
  `;
  const row = rows[0];
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return true;
  if (row.failCount < maxFails) return false;
  await prisma.boardLoginThrottle.update({
    where: { key },
    data: { lockedUntil: new Date(Date.now() + lockMs) },
  });
  return true;
}
