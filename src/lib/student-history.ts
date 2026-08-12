import "server-only";
import { prisma } from "@/lib/db";
import { normalizeMobile } from "@/lib/sms/phone";

/** 依手機找歷史學員（識別鍵）。號碼會先正規化成 09xxxxxxxx。 */
export async function findStudentByPhone(phone: string | null | undefined) {
  const mobile = normalizeMobile(phone);
  if (!mobile) return null;
  return prisma.studentRecord.findUnique({ where: { phone: mobile } });
}

/** 註冊時認領歷史學員資料。
 *
 *  以手機為主：夫妻、親子共用一個信箱很常見，單用 email 認領會把別人的上課
 *  紀錄掛到自己帳號上。email 只在「該信箱剛好只有一筆、且尚未被認領」時當備援；
 *  共用信箱有兩筆以上就不猜，等本人補手機再認領。
 *  已被其他帳號認領的紀錄一律不動。 */
export async function claimStudentRecord(
  userId: string,
  { email, phone }: { email?: string | null; phone?: string | null },
) {
  const byPhone = await findStudentByPhone(phone);
  if (byPhone) return claimIfFree(byPhone, userId);

  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  const matches = await prisma.studentRecord.findMany({ where: { email: normalized }, take: 2 });
  if (matches.length !== 1) return false; // 共用信箱無法判斷是誰
  return claimIfFree(matches[0], userId);
}

async function claimIfFree(
  record: { id: string; claimedUserId: string | null },
  userId: string,
) {
  if (record.claimedUserId) return false;
  await prisma.studentRecord.update({
    where: { id: record.id },
    data: { claimedUserId: userId, claimedAt: new Date() },
  });
  return true;
}
