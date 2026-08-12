// 學員資料庫「共用信箱」行為回歸測試（只跑本機 DB，會寫入再清掉測試列）
//
// 情境來源：蘇郁雅報名時填的是先生陳建中的信箱。email 當唯一鍵時第二個人根本建不了檔，
// 用 email 認領則會把另一半的上課紀錄掛到自己帳號上。識別鍵改成手機後，這支驗證：
//   共用信箱可各自建檔 / 手機找得到本人 / 共用信箱不亂認領 / 已認領的不被搶走。
//
// 用法：npx tsx scripts/test-student-claim.ts

// tsx 直跑會撞到 server-only 的守衛（它只准 RSC 匯入）→ 攔截 require 給空模組
const Mod = require("module");
const origLoad = Mod._load;
Mod._load = function (req: string, ...rest: unknown[]) {
  return req === "server-only" ? {} : origLoad.call(this, req, ...rest);
};

import { PrismaClient } from "@prisma/client";
const { claimStudentRecord, findStudentByPhone } = require("../src/lib/student-history");

if (!/@localhost[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("拒絕執行：DATABASE_URL 不是本機資料庫。這支測試會寫入資料。");
  process.exit(1);
}

const prisma = new PrismaClient();
const EMAIL = "shared+test@example.com";
const HUSBAND = "0911000001";
const WIFE = "0911000002";
const SOLO = "0911000003";
const U1 = "00000000-0000-0000-0000-0000000000a1";
const U2 = "00000000-0000-0000-0000-0000000000a2";

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}`);
};

async function main() {
  const phones = [HUSBAND, WIFE, SOLO];
  await prisma.studentRecord.deleteMany({ where: { phone: { in: phones } } });

  const h = await prisma.studentRecord.create({
    data: { phone: HUSBAND, email: EMAIL, name: "陳建中(測)" },
  });
  const w = await prisma.studentRecord.create({
    data: { phone: WIFE, email: EMAIL, name: "蘇郁雅(測)" },
  });
  check("共用信箱的兩個人可以各自建檔", h.id !== w.id);

  const found = await findStudentByPhone("0911-000-002");
  check("用手機找得到本人（號碼含分隔符也認）", found?.name === "蘇郁雅(測)");

  check("共用信箱又沒給手機 → 不認領（不猜是誰）", (await claimStudentRecord(U1, { email: EMAIL })) === false);

  check("給了手機 → 認領到本人那筆", (await claimStudentRecord(U1, { email: EMAIL, phone: WIFE })) === true);
  const claimed = await prisma.studentRecord.findUnique({ where: { phone: WIFE } });
  check("認領到的確實是蘇郁雅而非先生", claimed?.name === "蘇郁雅(測)" && claimed?.claimedUserId === U1);

  check("已被認領的紀錄不會被別的帳號搶走", (await claimStudentRecord(U2, { phone: WIFE })) === false);

  await prisma.studentRecord.create({
    data: { phone: SOLO, email: "solo+test@example.com", name: "獨立信箱(測)" },
  });
  check(
    "信箱只對到一筆時 email 仍可當認領備援",
    (await claimStudentRecord(U2, { email: "solo+test@example.com" })) === true,
  );

  await prisma.studentRecord.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
  console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
  process.exit(failed ? 1 : 0);
}

main();
