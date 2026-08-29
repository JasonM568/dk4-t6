/* 課前通知狀態（開課前重複匯入名單）的驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗的是這次改動唯一真正危險的地方：**誰會被重複發簡訊**。
 * 走正式那條 previewSmsAudience（與 executeSmsBroadcast 共用 resolveMobiles），
 * 不是另外抄一份邏輯來自我驗證。
 * 跑法：npx tsx --conditions=react-server scripts/test-session-notice-db.ts
 * 測完會刪掉自己建的場次與報名列。 */
import { prisma } from "../src/lib/db";
import { previewSmsAudience } from "../src/lib/sms/dispatch";
import { computeNoticeProgress } from "../src/lib/session-notice";

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

const SID = "test-notice-session";

async function cleanup() {
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.courseSession.deleteMany({ where: { id: SID } });
}

async function main() {
  await cleanup();
  await prisma.courseSession.create({
    data: { id: SID, title: "測試場次－課前通知", keywords: ["測試通知"], accessCode: "1234" },
  });

  // 第一批：兩位已通知、一位還沒；另有海外門號與無手機各一位
  await prisma.sessionSignup.createMany({
    data: [
      { sessionId: SID, orderNo: "N-1", attendeeKey: "buyer", name: "已通知甲", phone: "0900000101", email: "a@example.com", smsNoticeAt: new Date() },
      { sessionId: SID, orderNo: "N-2", attendeeKey: "buyer", name: "已通知乙", phone: "0900000102", email: "b@example.com", smsNoticeAt: new Date() },
      { sessionId: SID, orderNo: "N-3", attendeeKey: "buyer", name: "新報名丙", phone: "0900000103", email: "c@example.com" },
      { sessionId: SID, orderNo: "N-4", attendeeKey: "buyer", name: "海外丁", phone: "+8613800000000", email: "d@example.com" },
      { sessionId: SID, orderNo: "N-5", attendeeKey: "buyer", name: "無手機戊", phone: null, email: "e@example.com" },
    ],
  });

  console.log("\n只發還沒收到的人（PENDING）");
  const all = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "ALL",
  });
  const pending = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "PENDING",
  });
  // 海外門號不發國際簡訊、無手機者也發不到 → 兩者都不算「可發送」，只有 09 開頭的三位算
  check("全部範圍＝3 位可發（海外與無手機發不到）", all.sendableCount === 3, `實得 ${all.sendableCount}`);
  check("未通知範圍只剩新報名丙 1 位", pending.sendableCount === 1, `實得 ${pending.sendableCount}`);
  check("已通知的甲乙被排除", all.sendableCount - pending.sendableCount === 2);

  console.log("\n重複匯入後新報名的人會自動進未通知名單");
  await prisma.sessionSignup.create({
    data: { sessionId: SID, orderNo: "N-6", attendeeKey: "buyer", name: "二次匯入己", phone: "0900000106" },
  });
  const pending2 = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("新報名者自動被撈進來（1→2）", pending2.sendableCount === 2, `實得 ${pending2.sendableCount}`);

  console.log("\n延期出去的人不列入本場通知");
  await prisma.sessionSignup.updateMany({
    where: { sessionId: SID, orderNo: "N-6" },
    data: { deferredToSessionId: "other-session" },
  });
  const pendingDeferred = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("延期者被排除（2→1）", pendingDeferred.sendableCount === 1, `實得 ${pendingDeferred.sendableCount}`);
  await prisma.sessionSignup.updateMany({
    where: { sessionId: SID, orderNo: "N-6" },
    data: { deferredToSessionId: null },
  });

  console.log("\n發送成功回寫後就不再重複發");
  await prisma.sessionSignup.updateMany({
    where: { sessionId: SID, phone: { in: ["0900000103", "0900000106"] } },
    data: { smsNoticeAt: new Date() },
  });
  const pending3 = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("回寫後沒有人需要再發（不會重複發簡訊）", pending3.sendableCount === 0, `實得 ${pending3.sendableCount}`);

  console.log("\n送失敗的人維持未通知（下次自動撈回來）");
  await prisma.sessionSignup.updateMany({
    where: { sessionId: SID, orderNo: "N-3" },
    data: { smsNoticeAt: null }, // 模擬那筆送失敗，沒有回寫
  });
  const pending4 = await previewSmsAudience({
    audienceType: "SESSION", sessionIds: [SID], messageType: "NOTICE", noticeScope: "PENDING",
  });
  check("送失敗者回到未通知名單", pending4.sendableCount === 1, `實得 ${pending4.sendableCount}`);
  await prisma.sessionSignup.updateMany({
    where: { sessionId: SID, orderNo: "N-3" },
    data: { smsNoticeAt: new Date() },
  });

  console.log("\n場次卡片的進度數字");
  const rows = await prisma.sessionSignup.findMany({
    where: { sessionId: SID },
    select: { phone: true, email: true, smsNoticeAt: true, emailNoticeAt: true, deferredToSessionId: true },
  });
  const p = computeNoticeProgress(rows);
  check("未發簡訊 0 人", p.smsPending === 0, `實得 ${p.smsPending}`);
  check("已發簡訊 4 人（海外與無手機不算簡訊可達）", p.smsDone === 4, `實得 ${p.smsDone}`);
  check("Email 未發 5 人（海外丁與無手機戊都只能走 Email）", p.emailPending === 5, `實得 ${p.emailPending}`);
  check("每個人至少有一個管道，unreachable=0", p.unreachable === 0, `實得 ${p.unreachable}`);

  await cleanup();
  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
