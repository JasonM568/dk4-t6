import "server-only";
import { prisma } from "@/lib/db";
import { findStudentByContact } from "@/lib/student-history";

// 場次報名自動新舊生判定：用手機/email 查學員上課史，上過任一「複訓資格課程」
// （場次設定的 signupRetrainCourseIds，對應 CanonicalCourse.id）＝複訓，否則＝新生。
// 純伺服器端——定價一律以此重算，前端的偵測結果只是給使用者看，不可信。

export type StudentTier = "NEW" | "RETRAIN";

/** 逐位參加者判新舊生。qualifyingCourseIds 空 = 不分新舊生，一律 NEW。
 *  查學員：手機優先、email 備援（僅唯一一筆才採信）；查無此人＝新生。 */
export async function classifyTiers(
  contacts: { phone?: string | null; email?: string | null }[],
  qualifyingCourseIds: string[],
): Promise<StudentTier[]> {
  if (qualifyingCourseIds.length === 0) return contacts.map(() => "NEW");

  // 資格課程的所有課名原文（StudentCourseHistory.courseName 存原文，經 alias 對到標準課程）
  const aliases = await prisma.studentCourseAlias.findMany({
    where: { courseId: { in: qualifyingCourseIds } },
    select: { rawName: true },
  });
  const rawNames = aliases.map((a) => a.rawName);
  if (rawNames.length === 0) return contacts.map(() => "NEW");

  return Promise.all(
    contacts.map(async (c) => {
      const record = await findStudentByContact(c.phone, c.email);
      if (!record) return "NEW" as const;
      const hit = await prisma.studentCourseHistory.findFirst({
        where: { studentId: record.id, courseName: { in: rawNames } },
        select: { id: true },
      });
      return hit ? ("RETRAIN" as const) : ("NEW" as const);
    }),
  );
}

/** 依 tier 算每人單價：複訓且有設複訓價 → 複訓價；否則新生價。 */
export function priceForTier(
  tier: StudentTier,
  newPrice: number,
  retrainPrice: number | null,
): number {
  return tier === "RETRAIN" && retrainPrice != null ? retrainPrice : newPrice;
}
