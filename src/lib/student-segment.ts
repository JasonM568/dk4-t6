import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { HISTORY_KINDS } from "@/lib/student-course";

// 分眾圈人：依「上過／沒上過哪些標準課程」等條件從學員資料庫撈人。
// 條件走課名歸戶後的標準課程（StudentCourseAlias join），未歸戶的紀錄不參與判斷。
// 這裡只負責「查出是誰」；圈成名單群組（快照）由 action 處理，寄送走既有 EDM 流程。

export type SegmentFilter = {
  attended: string[]; // 上過其中任一標準課程（OR）
  excluded: string[]; // 且完全沒上過這些標準課程
  lastBefore?: string; // YYYY-MM-DD：此日期之後沒有任何上課紀錄（含日期空白的舊資料）
  minCourses?: number; // 至少上過 N 門不同標準課程（只算課程/訂閱/講座/活動）
};

export type SegmentStudent = { id: string; name: string | null; email: string | null; phone: string | null };

export function parseSegmentFilter(get: (k: string) => string[] | string | undefined): SegmentFilter {
  const arr = (k: string) => {
    const v = get(k);
    return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
  };
  const one = (k: string) => {
    const v = get(k);
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const min = Number(one("minCourses"));
  const lastBefore = one("lastBefore");
  return {
    attended: arr("attended"),
    excluded: arr("excluded"),
    lastBefore: lastBefore && /^\d{4}-\d{2}-\d{2}$/.test(lastBefore) ? lastBefore : undefined,
    minCourses: Number.isInteger(min) && min > 1 ? min : undefined,
  };
}

export function hasSegmentCondition(f: SegmentFilter): boolean {
  return f.attended.length > 0 || f.excluded.length > 0 || !!f.lastBefore || !!f.minCourses;
}

export async function querySegment(f: SegmentFilter): Promise<SegmentStudent[]> {
  if (!hasSegmentCondition(f)) return [];
  const inCourses = (ids: string[]) => Prisma.sql`
    EXISTS (SELECT 1 FROM "StudentCourseHistory" h
      JOIN "StudentCourseAlias" a ON a."rawName" = h."courseName"
      WHERE h."studentId" = r.id AND a."courseId" IN (${Prisma.join(ids)}))`;
  const conds: Prisma.Sql[] = [];
  if (f.attended.length) conds.push(inCourses(f.attended));
  if (f.excluded.length) conds.push(Prisma.sql`NOT ${inCourses(f.excluded)}`);
  if (f.lastBefore)
    conds.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "StudentCourseHistory" h
      WHERE h."studentId" = r.id AND h."attendedAt" >= ${new Date(`${f.lastBefore}T00:00:00+08:00`)})`);
  if (f.minCourses)
    conds.push(Prisma.sql`(SELECT count(DISTINCT a."courseId") FROM "StudentCourseHistory" h
      JOIN "StudentCourseAlias" a ON a."rawName" = h."courseName"
      JOIN "CanonicalCourse" c ON c.id = a."courseId"
      WHERE h."studentId" = r.id AND c.kind IN (${Prisma.join(HISTORY_KINDS)})) >= ${f.minCourses}`);
  return prisma.$queryRaw<SegmentStudent[]>`
    SELECT r.id, r.name, r.email, r.phone FROM "StudentRecord" r
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY r."createdAt" ASC`;
}
