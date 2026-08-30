/* 場次報名自動新舊生判定（classifyTiers / priceForTier）的驗證。
 * 會寫入資料庫，**只能對本機 localhost 跑**。
 * 跑法：npx tsx --conditions=react-server scripts/test-session-tier-db.ts */
import { prisma } from "../src/lib/db";
import { classifyTiers, priceForTier } from "../src/lib/session-student-tier";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`); }
}

const CC_ID = "test-qm-course";
const RAW = "測試量子思維初階";
const REC_OLD = "test-rec-old";
const REC_NEW = "test-rec-new";

async function cleanup() {
  await prisma.studentCourseHistory.deleteMany({ where: { studentId: { in: [REC_OLD, REC_NEW] } } });
  await prisma.studentRecord.deleteMany({ where: { id: { in: [REC_OLD, REC_NEW] } } });
  await prisma.studentCourseAlias.deleteMany({ where: { rawName: RAW } });
  await prisma.canonicalCourse.deleteMany({ where: { id: CC_ID } });
}

async function main() {
  await cleanup();
  // 標準課程 + 課名對照
  await prisma.canonicalCourse.create({ data: { id: CC_ID, name: "測試量子思維（勿用）", kind: "COURSE" } });
  await prisma.studentCourseAlias.create({ data: { rawName: RAW, courseId: CC_ID } });
  // 舊生：手機 0912111111，上過該課；新生：手機 0912222222，沒上過
  await prisma.studentRecord.create({ data: { id: REC_OLD, phone: "0912111111", name: "舊生", email: "old@test.local" } });
  await prisma.studentRecord.create({ data: { id: REC_NEW, phone: "0912222222", name: "新生", email: "new@test.local" } });
  await prisma.studentCourseHistory.create({ data: { studentId: REC_OLD, courseName: RAW } });

  // ① 上過資格課程的手機 → RETRAIN
  const t1 = await classifyTiers([{ phone: "0912111111", email: null }], [CC_ID]);
  check("上過量子課程的手機 → 複訓", t1[0] === "RETRAIN", t1[0]);

  // ② 資料庫有此人但沒上過資格課程 → NEW
  const t2 = await classifyTiers([{ phone: "0912222222", email: null }], [CC_ID]);
  check("有資料但沒上過 → 新生", t2[0] === "NEW", t2[0]);

  // ③ 查無此手機 → NEW
  const t3 = await classifyTiers([{ phone: "0900000000", email: null }], [CC_ID]);
  check("查無此人 → 新生", t3[0] === "NEW", t3[0]);

  // ④ email 備援（唯一一筆）→ RETRAIN
  const t4 = await classifyTiers([{ phone: null, email: "old@test.local" }], [CC_ID]);
  check("email 命中舊生 → 複訓", t4[0] === "RETRAIN", t4[0]);

  // ⑤ 資格課程空 → 一律 NEW
  const t5 = await classifyTiers([{ phone: "0912111111", email: null }], []);
  check("無資格課程設定 → 一律新生", t5[0] === "NEW", t5[0]);

  // ⑥ 混合同行者：舊生 + 新生
  const t6 = await classifyTiers(
    [{ phone: "0912111111", email: null }, { phone: "0912222222", email: null }],
    [CC_ID],
  );
  check("混合同行者判定正確", t6[0] === "RETRAIN" && t6[1] === "NEW", t6.join(","));

  // ⑦ priceForTier：複訓價缺 → 退回新生價
  check("複訓 → 複訓價", priceForTier("RETRAIN", 5880, 2380) === 2380);
  check("新生 → 新生價", priceForTier("NEW", 5880, 2380) === 5880);
  check("複訓但無複訓價 → 新生價", priceForTier("RETRAIN", 5880, null) === 5880);

  await cleanup();
  console.log(`\n場次新舊生判定：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
