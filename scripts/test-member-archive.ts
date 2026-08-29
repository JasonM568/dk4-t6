/** 會員封存資料模型回歸；只允許 localhost DB。 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

if (!/@localhost[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("安全鎖：只允許 localhost DATABASE_URL");
}

const prisma = new PrismaClient();
const userId = randomUUID();
const actorId = randomUUID();

async function main() {
  await prisma.$transaction([
    prisma.memberArchive.create({
      data: { userId, reason: "TEST 舊官網測試帳號", archivedBy: "test@localhost" },
    }),
    prisma.adminAuditLog.create({
      data: {
        action: "MEMBER_ARCHIVE",
        actorId,
        actorEmail: "test@localhost",
        targetId: userId,
        success: true,
        detail: "TEST 舊官網測試帳號",
      },
    }),
  ]);
  const row = await prisma.memberArchive.findUnique({ where: { userId } });
  if (!row || row.reason !== "TEST 舊官網測試帳號") throw new Error("封存資料建立失敗");
  await prisma.memberArchive.delete({ where: { userId } });
  const audit = await prisma.adminAuditLog.findFirst({ where: { targetId: userId, action: "MEMBER_ARCHIVE" } });
  if (!audit) throw new Error("解除封存後 audit 應保留");
  await prisma.adminAuditLog.delete({ where: { id: audit.id } });
  console.log("✓ member archive schema regression passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
