/* 簡訊模組「講座索取者」名單來源的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗的是這條新名單來源會不會發錯人／重複發：走正式的 previewSmsAudience
 * 與 resolveSmsFollowUp（與 executeSmsBroadcast 共用 resolveMobiles），
 * 不另抄一份邏輯自我驗證。
 * 跑法：npx tsx --conditions=react-server scripts/test-webinar-sms-db.ts
 * 測完會刪掉自己建的講座、索取紀錄與退訂列。 */
import { prisma } from "../src/lib/db";
import { previewSmsAudience, executeSmsBroadcast, resolveSmsFollowUp } from "../src/lib/sms/dispatch";

// 安全鎖：非本機資料庫一律拒跑（鐵則：絕不對正式站跑寫入測試）
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}

const W1 = "test-webinar-sms-1";
const W2 = "test-webinar-sms-2";
const OPT_USER = "0900000206"; // 自行退訂（只擋行銷）
const OPT_INVALID = "0900000207"; // 空號（行銷與履約都擋）
const BCAST_TITLE = "測試－講座提醒簡訊";

async function cleanup() {
  await prisma.smsMessage.deleteMany({ where: { broadcast: { title: BCAST_TITLE } } });
  await prisma.smsBroadcast.deleteMany({ where: { title: BCAST_TITLE } });
  await prisma.webinarRequest.deleteMany({ where: { webinarId: { in: [W1, W2] } } });
  await prisma.webinar.deleteMany({ where: { id: { in: [W1, W2] } } });
  await prisma.smsOptOut.deleteMany({ where: { mobile: { in: [OPT_USER, OPT_INVALID] } } });
}

const base = {
  description: "測試",
  lectureUrl: "https://example.com/zoom",
  emailSubject: "測試",
  emailBody: "測試 {link}",
};

async function main() {
  await cleanup();
  await prisma.webinar.createMany({
    data: [
      { id: W1, slug: W1, title: "測試講座一", ...base },
      { id: W2, slug: W2, title: "測試講座二", ...base },
    ],
  });

  await prisma.webinarRequest.createMany({
    data: [
      // 講座一
      { webinarId: W1, email: "a@example.com", name: "甲", phone: "0900000201" },
      { webinarId: W1, email: "b@example.com", name: "乙", phone: "0900000202", smsNoticeAt: new Date() },
      { webinarId: W1, email: "c@example.com", name: "丙", phone: "0900000201" }, // 與甲同號
      { webinarId: W1, email: "d@example.com", name: "丁", phone: null }, // 手機必填上線前的舊紀錄
      { webinarId: W1, email: "e@example.com", name: "戊", phone: "+8613800000000" }, // 海外，不發國際簡訊
      { webinarId: W1, email: "f@example.com", name: "己", phone: OPT_USER },
      { webinarId: W1, email: "g@example.com", name: "庚", phone: OPT_INVALID },
      // 講座二：與講座一的甲同號（跨講座重複）
      { webinarId: W2, email: "a@example.com", name: "甲", phone: "0900000201" },
      { webinarId: W2, email: "h@example.com", name: "辛", phone: "0900000205" },
    ],
  });
  await prisma.smsOptOut.createMany({
    data: [
      { mobile: OPT_USER, source: "USER", reason: "測試自行退訂" },
      { mobile: OPT_INVALID, source: "INVALID", reason: "測試空號" },
    ],
  });

  console.log("\n名單解析（單一講座）");
  const one = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [W1],
    messageType: "NOTICE", noticeScope: "ALL",
  });
  check("總筆數 = 7", one.totalRows === 7, `實際 ${one.totalRows}`);
  check(
    "沒手機／海外門號算 2 人收不到",
    one.noMobileCount === 2,
    `實際 ${one.noMobileCount}`,
  );
  check("同號去重後 4 人", one.uniqueCount === 4, `實際 ${one.uniqueCount}`);
  check("重複 1 筆（甲丙同號）", one.duplicateCount === 1, `實際 ${one.duplicateCount}`);
  check(
    "履約通知只擋空號 → 可發 3 人",
    one.sendableCount === 3,
    `實際 ${one.sendableCount}`,
  );
  check("被擋 1 人（空號）", one.optedOutCount === 1, `實際 ${one.optedOutCount}`);
  check("講座沒有上課碼 → withCodeCount = 0", one.withCodeCount === 0);
  check("來源標籤是講座名稱", one.sources[0]?.label === "測試講座一");

  console.log("\n行銷推播：自行退訂的也要擋掉");
  const mk = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [W1],
    messageType: "MARKETING", noticeScope: "ALL",
  });
  check("可發 2 人（再扣掉自行退訂）", mk.sendableCount === 2, `實際 ${mk.sendableCount}`);
  check("被擋 2 人", mk.optedOutCount === 2, `實際 ${mk.optedOutCount}`);

  console.log("\n只發還沒收到的人（PENDING）");
  const pending = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [W1],
    messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("已通知的乙被排除 → 總筆數 6", pending.totalRows === 6, `實際 ${pending.totalRows}`);
  check("可發 2 人（乙不再收到）", pending.sendableCount === 2, `實際 ${pending.sendableCount}`);

  console.log("\n跨講座複選");
  const both = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [W1, W2],
    messageType: "NOTICE", noticeScope: "ALL",
  });
  check("總筆數 = 9", both.totalRows === 9, `實際 ${both.totalRows}`);
  check("兩場都登記的甲只算一次 → 可發 4 人", both.sendableCount === 4, `實際 ${both.sendableCount}`);
  check("兩個來源都列出", both.sources.length === 2, `實際 ${both.sources.length}`);
  check(
    "勾選順序決定來源排序",
    both.sources[0]?.label === "測試講座一" && both.sources[1]?.label === "測試講座二",
  );

  console.log("\n邊界");
  const none = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [],
    messageType: "NOTICE", noticeScope: "ALL",
  });
  check("沒勾任何講座 → 空預覽", none.sendableCount === 0 && none.totalRows === 0);
  const ghost = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: ["no-such-webinar"],
    messageType: "NOTICE", noticeScope: "ALL",
  });
  check("講座已被刪除 → missingCount = 1", ghost.missingCount === 1, `實際 ${ghost.missingCount}`);

  console.log("\n實際發送 → 只回寫 WebinarRequest.smsNoticeAt");
  // 發送前先把場次名單的狀態拍個快照：回寫如果寫錯表，這裡會看得出來
  const sessionTouchedBefore = await prisma.sessionSignup.count({
    where: { smsNoticeAt: { not: null } },
  });
  const bcast = await prisma.smsBroadcast.create({
    data: {
      title: BCAST_TITLE,
      body: "{name} 您好，提醒您講座即將開始。",
      messageType: "NOTICE",
      audienceType: "WEBINAR",
      webinarIds: [W1],
      noticeScope: "PENDING",
      status: "SENDING",
      claimedAt: new Date(),
    },
  });
  const sent = await executeSmsBroadcast(bcast.id);
  check("送出 2 人（PENDING 名單）", sent.sent === 2, `實際 ${sent.sent}`);

  const after = await prisma.webinarRequest.findMany({
    where: { webinarId: W1 },
    select: { name: true, phone: true, smsNoticeAt: true },
  });
  const noticed = (n: string) => !!after.find((r) => r.name === n)?.smsNoticeAt;
  check("甲已標記已通知", noticed("甲"));
  check("與甲同號的丙一起標記（同一封簡訊等於通知到）", noticed("丙"));
  check("被空號擋掉的庚維持未通知", !noticed("庚"));
  check("沒手機的丁維持未通知", !noticed("丁"));
  check("海外門號的戊維持未通知", !noticed("戊"));
  check(
    "沒有誤寫到場次名單",
    (await prisma.sessionSignup.count({ where: { smsNoticeAt: { not: null } } })) ===
      sessionTouchedBefore,
  );

  console.log("\n再發一次 PENDING：剛通知過的人不會重複收到");
  const again = await previewSmsAudience({
    audienceType: "WEBINAR", sessionIds: [], webinarIds: [W1],
    messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("可發 0 人", again.sendableCount === 0, `實際 ${again.sendableCount}`);

  console.log("\n補發名單（差集）");
  const fu = await resolveSmsFollowUp(bcast.id);
  check("WEBINAR 紀錄可以算補發（不再被擋）", !fu.error, fu.error);
  check(
    "已送到的不列入補發",
    fu.rows.every((r) => r.mobile !== "0900000201"),
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
