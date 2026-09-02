/* 「從會員資料補手機」的規則驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 這支盯的是唯一真正危險的事：**會不會把別人的手機寫到這個人身上**。
 * 訂購人常拿自己的信箱幫別人報名，正式資料就有現成案例
 * （tsung0906 底下同時有陳建中與蘇郁雅），所以「姓名不同＝不寫」必須有測試釘住。
 * 跑法：npx tsx --conditions=react-server scripts/test-webinar-phone-backfill-db.ts
 * 測完會刪掉自己建的資料。Supabase Auth 查詢一律注入假實作，不碰正式站。 */
import { prisma } from "../src/lib/db";
import { backfillWebinarPhones } from "../src/lib/webinar-phone-backfill";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`); }
}

const W = "test-backfill-webinar";
const SID = "test-backfill-session";
// 假的 auth 查詢：永遠回空，測試不碰 Supabase（MemberProfile 這條來源在測試中不參與）
const noAuth = async () => new Map<string, string>();

async function cleanup() {
  await prisma.webinarRequest.deleteMany({ where: { webinarId: W } });
  await prisma.webinar.deleteMany({ where: { id: W } });
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
  await prisma.studentRecord.deleteMany({ where: { email: { endsWith: "@backfill.test" } } });
}

async function main() {
  await cleanup();
  await prisma.webinar.create({
    data: {
      id: W, slug: W, title: "測試講座－補手機", description: "x",
      lectureUrl: "https://example.com/z", emailSubject: "x", emailBody: "x {link}",
    },
  });
  await prisma.courseSession.create({ data: { id: SID, title: "測試場次－補手機" } });

  // ── 來源資料 ──
  await prisma.studentRecord.createMany({
    data: [
      { email: "match@backfill.test", name: "王小明", phone: "0900000301" },      // 姓名吻合
      { email: "proxy@backfill.test", name: "鄧樹森", phone: "0900000302" },      // 代填：姓名不同
      { email: "couple@backfill.test", name: "陳建中", phone: "0900000303" },     // 共用信箱：本人
      { email: "couple2@backfill.test", name: "蘇郁雅", phone: "0900000304" },    // 共用信箱：配偶（另一筆）
      { email: "twophone@backfill.test", name: "李四", phone: "0900000305" },     // 同名兩支號碼之一
      { email: "landline@backfill.test", name: "市話伯", phone: "0227001234" },   // 市話，不可採用
      { email: "spaced@backfill.test", name: "陳 大文", phone: "0900000307" },    // 姓名含空白
    ],
  });
  // 共用信箱的第二個人與「同名兩支號碼」的第二支，放在訂單來源
  await prisma.sessionSignup.createMany({
    data: [
      { sessionId: SID, orderNo: "B-1", attendeeKey: "buyer", name: "蘇郁雅", email: "couple@backfill.test", phone: "0900000304" },
      { sessionId: SID, orderNo: "B-2", attendeeKey: "buyer", name: "李四", email: "twophone@backfill.test", phone: "0900000306" },
    ],
  });

  // ── 目標：講座索取名單 ──
  await prisma.webinarRequest.createMany({
    data: [
      { webinarId: W, email: "match@backfill.test", name: "王小明" },
      { webinarId: W, email: "proxy@backfill.test", name: "賴家瑜" },
      { webinarId: W, email: "couple@backfill.test", name: "陳建中" },
      { webinarId: W, email: "twophone@backfill.test", name: "李四" },
      { webinarId: W, email: "landline@backfill.test", name: "市話伯" },
      { webinarId: W, email: "spaced@backfill.test", name: "陳大文" },
      { webinarId: W, email: "nobody@backfill.test", name: "查無此人" },
      { webinarId: W, email: "hasphone@backfill.test", name: "已有手機", phone: "0900000399" },
    ],
  });

  console.log("\n試算（apply=false）不應寫入任何東西");
  const dry = await backfillWebinarPhones(W, { apply: false, lookupAuthIds: noAuth });
  const stillNull = await prisma.webinarRequest.count({ where: { webinarId: W, phone: null } });
  check("試算後仍有 7 筆沒手機", stillNull === 7, `實際 ${stillNull}`);
  check("試算已算出 3 筆可補", dry.filled === 3, `實際 ${dry.filled}`);

  console.log("\n實際寫入（apply=true）");
  const r = await backfillWebinarPhones(W, { apply: true, lookupAuthIds: noAuth });
  const by = (email: string) => r.rows.find((x) => x.email === email);
  const saved = async (email: string) =>
    (await prisma.webinarRequest.findFirst({ where: { webinarId: W, email } }))?.phone ?? null;

  check("姓名吻合 → 寫入", (await saved("match@backfill.test")) === "0900000301");
  check("姓名含空白也算吻合（陳 大文＝陳大文）", (await saved("spaced@backfill.test")) === "0900000307");

  console.log("\n代填／共用信箱（最危險的兩種）");
  check("姓名不同 → 不寫", (await saved("proxy@backfill.test")) === null);
  check("姓名不同 → 標為需人工確認", by("proxy@backfill.test")?.status === "REVIEW");
  check(
    "需確認時要附上查到的號碼與該筆的姓名",
    by("proxy@backfill.test")?.candidates[0]?.sourceName === "鄧樹森",
  );
  check(
    "共用信箱只取姓名吻合的那一支（不是配偶的）",
    (await saved("couple@backfill.test")) === "0900000303",
    `實際 ${await saved("couple@backfill.test")}`,
  );

  console.log("\n其他不敢猜的情況");
  check("同名兩支不同號碼 → 不寫", (await saved("twophone@backfill.test")) === null);
  check("同名兩支不同號碼 → 需人工確認", by("twophone@backfill.test")?.status === "REVIEW");
  check("市話不採用 → 查無", by("landline@backfill.test")?.status === "NOT_FOUND");
  check("市話不採用 → 不寫", (await saved("landline@backfill.test")) === null);
  check("完全查無 → NOT_FOUND", by("nobody@backfill.test")?.status === "NOT_FOUND");
  check("已有手機的不在處理範圍", !by("hasphone@backfill.test"));
  check("已有手機的號碼沒被動到", (await saved("hasphone@backfill.test")) === "0900000399");

  console.log("\n統計與冪等");
  check("已補 3 筆", r.filled === 3, `實際 ${r.filled}`);
  check("需確認 2 筆", r.review === 2, `實際 ${r.review}`);
  check("查無 2 筆", r.notFound === 2, `實際 ${r.notFound}`);
  const again = await backfillWebinarPhones(W, { apply: true, lookupAuthIds: noAuth });
  check("再跑一次不會重複補（已補的不再處理）", again.filled === 0, `實際 ${again.filled}`);

  console.log("\n撞號保護");
  // 讓「查無此人」的 email 也能查到 0900000301（已被王小明用掉的號碼）。
  // 走訂單來源而不是記錄卡——StudentRecord.phone 有唯一鍵，同號建不了第二筆。
  await prisma.sessionSignup.create({
    data: {
      sessionId: SID, orderNo: "B-3", attendeeKey: "buyer",
      name: "查無此人", email: "nobody@backfill.test", phone: "0900000301",
    },
  });
  const dup = await backfillWebinarPhones(W, { apply: true, lookupAuthIds: noAuth });
  check(
    "號碼已被本場其他人用 → 不寫，改列人工確認",
    dup.rows.find((x) => x.email === "nobody@backfill.test")?.status === "REVIEW" &&
      (await saved("nobody@backfill.test")) === null,
  );

  console.log(`\n${pass} 過 / ${fail} 失敗`);
  await cleanup();
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
