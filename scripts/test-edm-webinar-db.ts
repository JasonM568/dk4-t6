/* EDM「講座索取者」名單來源的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗的是這次改動唯一真正危險的地方：誰收得到信、誰收不到，以及
 * 「已結束的講座」名單還撈不撈得到（原本簡訊那邊就是被選單擋住才撈不到的）。
 * 走的是正式那條 previewWebinarAudience——與 executeBroadcast 共用
 * collectWebinarRequests → dedupeByEmail → filterUnsubscribed，不另抄一份邏輯。
 *
 * 跑法：npx tsx --conditions=react-server scripts/test-edm-webinar-db.ts
 *（dispatch.ts 是 server-only，純 node 條件下該套件會 throw）
 * 測完會刪掉自己建的講座、索取紀錄與退訂列。 */
import { prisma } from "../src/lib/db";
import { previewWebinarAudience } from "../src/lib/email/dispatch";

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
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

const TAG = "edm-webinar-test";
const E = {
  a: `${TAG}-a@example.com`,
  b: `${TAG}-b@example.com`,
  both: `${TAG}-both@example.com`, // 兩場都索取 → 去重後只算一人
  unsub: `${TAG}-unsub@example.com`, // 自行退訂電子報
  bounced: `${TAG}-bounce@example.com`,
  bad: `${TAG}-not-an-email`, // 壞資料：不合法 email
};

function webinarData(slug: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    title,
    description: TAG,
    lectureUrl: "https://example.com/lecture",
    emailSubject: TAG,
    emailBody: TAG,
    ...extra,
  };
}

async function cleanup() {
  // requests 走 onDelete: Cascade，刪講座即連帶清掉
  await prisma.webinar.deleteMany({ where: { description: TAG } });
  await prisma.mailUnsubscribe.deleteMany({
    where: { email: { in: Object.values(E) } },
  });
}

async function main() {
  await cleanup();

  // 一場進行中、一場「已結束很久」——名單解析不該看這個旗標
  const live = await prisma.webinar.create({
    data: webinarData(`${TAG}-live`, `${TAG} 進行中`),
  });
  const ended = await prisma.webinar.create({
    data: webinarData(`${TAG}-ended`, `${TAG} 已結束`, {
      isActive: false,
      endDate: new Date("2026-01-01T00:00:00Z"),
      unpublishAt: new Date("2026-01-01T00:00:00Z"),
    }),
  });

  await prisma.webinarRequest.createMany({
    data: [
      { webinarId: live.id, email: E.a, name: "甲" },
      { webinarId: live.id, email: E.both, name: "丙（進行中版）" },
      { webinarId: ended.id, email: E.b, name: "乙" },
      { webinarId: ended.id, email: E.both, name: "丙（已結束版）" },
      { webinarId: ended.id, email: E.unsub, name: "丁" },
      { webinarId: ended.id, email: E.bounced, name: "戊" },
      { webinarId: ended.id, email: E.bad, name: "己" },
    ],
  });

  await prisma.mailUnsubscribe.createMany({
    data: [
      { email: E.unsub, source: "USER" },
      { email: E.bounced, source: "BOUNCE" },
    ],
  });

  console.log("\n已結束的講座名單照樣撈得到（這次改動的重點）");
  {
    const p = await previewWebinarAudience([ended.id]);
    check("撈到 5 筆索取紀錄", p.totalRows === 5, `實得 ${p.totalRows}`);
    check("壞 email 算進 noEmailCount", p.noEmailCount === 1, `實得 ${p.noEmailCount}`);
    check("去重後 4 人", p.uniqueCount === 4, `實得 ${p.uniqueCount}`);
    check(
      "退訂 + 退信各扣一人 → 可寄 2 人",
      p.sendableCount === 2,
      `實得 ${p.sendableCount}`,
    );
    check("退訂扣除數為 2", p.unsubscribedCount === 2, `實得 ${p.unsubscribedCount}`);
    check("講座標題帶得出來", p.webinars[0]?.title === `${TAG} 已結束`);
  }

  console.log("\n跨講座去重：兩場都索取的人只算一次");
  {
    const p = await previewWebinarAudience([live.id, ended.id]);
    check("原始筆數 7", p.totalRows === 7, `實得 ${p.totalRows}`);
    check(
      "去重後 5 人（甲乙丙丁戊）",
      p.uniqueCount === 5,
      `實得 ${p.uniqueCount}`,
    );
    check("跨講座重複 1 筆", p.duplicateCount === 1, `實得 ${p.duplicateCount}`);
    check("可寄 3 人（扣掉丁與戊）", p.sendableCount === 3, `實得 ${p.sendableCount}`);
    check("兩場都列進來源明細", p.webinars.length === 2);
  }

  console.log("\n退訂分流：講座名單一律 MARKETING，退訂者不得被寄到");
  {
    // 即使呼叫端傳 NOTICE（不該發生，previewWebinarAudienceAction 寫死 MARKETING），
    // 這裡確認兩者的差異真的存在——確保上面的 2 人不是碰巧
    const marketing = await previewWebinarAudience([ended.id], "MARKETING");
    const notice = await previewWebinarAudience([ended.id], "NOTICE");
    check(
      "MARKETING 擋掉自行退訂者",
      marketing.sendableCount === 2,
      `實得 ${marketing.sendableCount}`,
    );
    check(
      "NOTICE 只擋退信 → 會多一人（證明分流真的有作用）",
      notice.sendableCount === 3,
      `實得 ${notice.sendableCount}`,
    );
  }

  console.log("\n邊界");
  {
    const empty = await previewWebinarAudience([]);
    check("沒勾任何講座 → 零值", empty.sendableCount === 0 && empty.totalRows === 0);
    const missing = await previewWebinarAudience(["does-not-exist"]);
    check("講座不存在 → missingCount 標出來", missing.missingCount === 1);
    check("講座不存在 → 不會誤寄", missing.sendableCount === 0);
  }

  await cleanup();
  console.log(`\n${pass} 過 / ${fail} 失敗`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup();
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
