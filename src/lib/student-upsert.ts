import "server-only";

import { prisma } from "@/lib/db";

// 學員記錄卡的找／建入口。原本是 actions/student-history.ts 的私有函式，
// 2026-09-29 名單收集模組要共用而抽出來——那是 "use server" 檔案，
// 只能匯出 async 函式，常數與同步函式一律得放 lib。
//
// 這支是訂單匯入與學員記錄卡的共用核心，改動前務必先想清楚會不會把兩個人併成一張卡。

/** 空白與大小寫不影響同名判定；任一方沒填姓名視為相容（可補空） */
export const sameStudentName = (
  a: string | null | undefined,
  b: string | null | undefined,
) => {
  const na = (a ?? "").replace(/\s+/g, "").toLowerCase();
  const nb = (b ?? "").replace(/\s+/g, "").toLowerCase();
  return !na || !nb || na === nb;
};

/** 依手機（優先）→ email 找/建學員檔。
 *  鐵則：姓名不同＝不同人，絕不併卡、絕不覆蓋姓名——訂購人常幫同行者填
 *  自己的電話/信箱（一個信箱兩個姓名），舊版直接併卡還覆蓋姓名，
 *  同行者的紀錄會黏到訂購人卡上（2026-08-29 徐裕森/潘月時案）。
 *  姓名/信箱一律只補空；撞到別人的手機 → 退回信箱路徑（新卡不帶那支手機）；
 *  同信箱不同姓名 → 各自一張卡（夫妻共用信箱模式），重匯時按姓名找回同一張（冪等）。 */
export async function upsertStudent(
  phone: string | null,
  email: string | null,
  name: string | null,
): Promise<{ id: string } | null> {
  if (phone) {
    const byPhone = await prisma.studentRecord.findUnique({
      where: { phone },
      select: { id: true, name: true, email: true },
    });
    if (!byPhone)
      return prisma.studentRecord.create({ data: { phone, name, email }, select: { id: true } });
    if (sameStudentName(byPhone.name, name)) {
      const fill: { name?: string; email?: string } = {};
      if (!byPhone.name && name) fill.name = name;
      if (!byPhone.email && email) fill.email = email;
      if (Object.keys(fill).length)
        await prisma.studentRecord.update({ where: { id: byPhone.id }, data: fill });
      return { id: byPhone.id };
    }
    // 同號不同名：這支手機是別人的（同行者填了訂購人的號碼），改走信箱路徑
  }
  if (email) {
    const candidates = await prisma.studentRecord.findMany({
      where: { email },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    const hit = candidates.find((c) => sameStudentName(c.name, name));
    if (hit) {
      if (!hit.name && name)
        await prisma.studentRecord.update({ where: { id: hit.id }, data: { name } });
      return { id: hit.id };
    }
    return prisma.studentRecord.create({ data: { email, name }, select: { id: true } });
  }
  return null;
}
