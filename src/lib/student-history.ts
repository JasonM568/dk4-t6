import "server-only";
import { prisma } from "@/lib/db";
import { normalizeMobile } from "@/lib/sms/phone";
import { isSamePerson } from "@/lib/session-roster";

/** 依手機找歷史學員（識別鍵）。號碼會先正規化成 09xxxxxxxx。 */
export async function findStudentByPhone(phone: string | null | undefined) {
  const mobile = normalizeMobile(phone);
  if (!mobile) return null;
  return prisma.studentRecord.findUnique({ where: { phone: mobile } });
}

/** 依聯絡方式找歷史學員（純識別，不認領）：手機優先，查不到再用 email——
 *  且 email 僅在「該信箱剛好唯一一筆」時才採信（共用信箱不猜，比照 claimStudentRecord）。 */
export async function findStudentByContact(
  phone?: string | null,
  email?: string | null,
) {
  const byPhone = await findStudentByPhone(phone);
  if (byPhone) return byPhone;
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const matches = await prisma.studentRecord.findMany({
    where: { email: normalized },
    take: 2,
  });
  return matches.length === 1 ? matches[0] : null;
}

/** 註冊時認領歷史學員資料。
 *
 *  以手機為主：夫妻、親子共用一個信箱很常見，單用 email 認領會把別人的上課
 *  紀錄掛到自己帳號上。email 只在「該信箱剛好只有一筆、且尚未被認領」時當備援；
 *  共用信箱有兩筆以上就不猜，等本人補手機再認領。
 *  已被其他帳號認領的紀錄一律不動。 */
export async function claimStudentRecord(
  userId: string,
  { email, phone, name }: { email?: string | null; phone?: string | null; name?: string | null },
) {
  const byPhone = await findStudentByPhone(phone);
  if (byPhone) return claimIfFree(byPhone, userId, name, phone);

  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  const matches = await prisma.studentRecord.findMany({ where: { email: normalized }, take: 2 });
  if (matches.length !== 1) return false; // 共用信箱無法判斷是誰
  return claimIfFree(matches[0], userId, name, phone);
}

async function claimIfFree(
  record: { id: string; claimedUserId: string | null; name: string | null; phone: string | null },
  userId: string,
  name?: string | null,
  phone?: string | null,
) {
  if (record.claimedUserId) return false;
  if (record.name && (!name || !isSamePerson(
    { name: record.name, phone: record.phone },
    { name, phone: normalizeMobile(phone) ?? phone },
  ))) {
    console.warn("[student-history] 姓名或手機不符，略過歷史紀錄認領", { studentId: record.id, userId });
    return false;
  }
  await prisma.studentRecord.update({
    where: { id: record.id },
    data: { claimedUserId: userId, claimedAt: new Date() },
  });
  return true;
}
