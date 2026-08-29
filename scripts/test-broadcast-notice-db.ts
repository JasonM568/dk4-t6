/* EDM「履約通知 vs 行銷推播」的退訂過濾驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * 驗的是這次改動唯一真正危險的地方：誰收得到信、誰收不到。
 * 走的是正式那條 previewSessionAudience（與 executeBroadcast 共用 filterUnsubscribed），
 * 不是另外抄一份邏輯來自我驗證。
 * 跑法：npx tsx --conditions=react-server scripts/test-broadcast-notice-db.ts
 *（dispatch.ts 是 server-only，純 node 條件下該套件會 throw）
 * 測完會刪掉自己建的場次、報名與退訂列。 */
import { prisma } from "../src/lib/db";
import { previewSessionAudience } from "../src/lib/email/dispatch";
import { resolveFollowUpEmails } from "../src/lib/email/followup";

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

const TAG = "notice-test";
const EMAILS = {
  clean: `${TAG}-clean@example.com`,
  userUnsub: `${TAG}-user@example.com`, // 自行退訂電子報
  bounced: `${TAG}-bounce@example.com`, // 信箱退信
  complained: `${TAG}-spam@example.com`, // 檢舉垃圾信
};

async function cleanup(sessionId?: string, broadcastId?: string) {
  if (sessionId)
    await prisma.courseSession.deleteMany({ where: { id: sessionId } }); // cascade 連報名
  if (broadcastId) {
    await prisma.broadcastEvent.deleteMany({ where: { broadcastId } });
    await prisma.emailBroadcastRecipient.deleteMany({ where: { broadcastId } });
    await prisma.emailBroadcast.deleteMany({ where: { id: broadcastId } });
  }
  await prisma.mailUnsubscribe.deleteMany({
    where: { email: { in: Object.values(EMAILS) } },
  });
}

async function main() {
  await cleanup();
  let broadcastId: string | undefined;

  const session = await prisma.courseSession.create({
    data: { title: `${TAG} 場次`, keywords: [TAG] },
  });

  try {
    await prisma.sessionSignup.createMany({
      data: [
        { sessionId: session.id, orderNo: `${TAG}-1`, name: "乾淨", email: EMAILS.clean },
        { sessionId: session.id, orderNo: `${TAG}-2`, name: "退訂電子報", email: EMAILS.userUnsub },
        { sessionId: session.id, orderNo: `${TAG}-3`, name: "退信", email: EMAILS.bounced },
        { sessionId: session.id, orderNo: `${TAG}-4`, name: "檢舉", email: EMAILS.complained },
        // 沒有 email 的同行者：兩種模式都收不到，且必須被數出來而不是無聲消失
        { sessionId: session.id, orderNo: `${TAG}-5`, name: "沒信箱", email: null },
      ],
    });
    await prisma.mailUnsubscribe.createMany({
      data: [
        { email: EMAILS.userUnsub, source: "USER" },
        { email: EMAILS.bounced, source: "BOUNCE" },
        { email: EMAILS.complained, source: "COMPLAINT" },
      ],
    });

    console.log("\n行銷推播（MARKETING）：整份退訂名單全擋");
    const mk = await previewSessionAudience([session.id], "MARKETING");
    check("名單合計 5 人", mk.totalRows === 5, `實際 ${mk.totalRows}`);
    check("沒有 email 的 1 人被數出來", mk.noEmailCount === 1, `實際 ${mk.noEmailCount}`);
    check("去重後 4 人", mk.uniqueCount === 4, `實際 ${mk.uniqueCount}`);
    check("扣除退訂 3 人（USER+BOUNCE+COMPLAINT）", mk.unsubscribedCount === 3, `實際 ${mk.unsubscribedCount}`);
    check("實際可寄 1 人", mk.sendableCount === 1, `實際 ${mk.sendableCount}`);

    console.log("\n履約通知（NOTICE）：只擋退信與檢舉，退訂電子報的人照寄");
    const nt = await previewSessionAudience([session.id], "NOTICE");
    check("名單合計 5 人", nt.totalRows === 5, `實際 ${nt.totalRows}`);
    check("沒有 email 的 1 人仍被數出來", nt.noEmailCount === 1, `實際 ${nt.noEmailCount}`);
    check("只扣 2 人（BOUNCE+COMPLAINT）", nt.unsubscribedCount === 2, `實際 ${nt.unsubscribedCount}`);
    check("實際可寄 2 人（含自行退訂電子報者）", nt.sendableCount === 2, `實際 ${nt.sendableCount}`);
    check(
      "NOTICE 比 MARKETING 多救回 1 人",
      nt.sendableCount - mk.sendableCount === 1,
      `NOTICE ${nt.sendableCount} / MARKETING ${mk.sendableCount}`,
    );

    console.log("\n延期的人不收原場次通知");
    const target = await prisma.courseSession.create({
      data: { title: `${TAG} 目標場次`, keywords: [] },
    });
    await prisma.sessionSignup.updateMany({
      where: { sessionId: session.id, orderNo: `${TAG}-1` },
      data: { deferredToSessionId: target.id },
    });
    const after = await previewSessionAudience([session.id], "NOTICE");
    check("延期後原場次少 1 人", after.totalRows === 4, `實際 ${after.totalRows}`);
    check(
      "延期的人不在可寄名單",
      after.sendableCount === 1,
      `實際 ${after.sendableCount}`,
    );
    await prisma.courseSession.deleteMany({ where: { id: target.id } });

    console.log("\n跟進信只使用 provider ACCEPTED 母集合");
    const broadcast = await prisma.emailBroadcast.create({
      data: {
        subject: `${TAG} followup`,
        body: "test",
        status: "SENT",
        sentCount: 2,
        failedCount: 1,
        recipients: [EMAILS.clean, EMAILS.userUnsub],
      },
    });
    broadcastId = broadcast.id;
    await prisma.emailBroadcastRecipient.createMany({
      data: [
        {
          broadcastId,
          email: EMAILS.clean,
          status: "ACCEPTED",
          providerMessageId: "test-clean",
        },
        {
          broadcastId,
          email: EMAILS.userUnsub,
          status: "ACCEPTED",
          providerMessageId: "test-user",
        },
        {
          broadcastId,
          email: EMAILS.bounced,
          status: "FAILED",
          failureReason: "mock provider failure",
        },
      ],
    });
    await prisma.broadcastEvent.createMany({
      data: [
        { broadcastId, email: EMAILS.clean, type: "OPENED" },
        // 即使 FAILED 地址出現異常事件，也不得進跟進名單。
        { broadcastId, email: EMAILS.bounced, type: "OPENED" },
      ],
    });
    await prisma.broadcastEvent.createMany({
      data: [{ broadcastId, email: EMAILS.clean, type: "OPENED" }],
      skipDuplicates: true,
    });
    const [recipientRows, followupEvents] = await Promise.all([
      prisma.emailBroadcastRecipient.findMany({
        where: { broadcastId },
        select: { email: true, status: true },
      }),
      prisma.broadcastEvent.findMany({
        where: { broadcastId },
        select: { email: true, type: true },
      }),
    ]);
    const accepted = recipientRows
      .filter((row) => row.status === "ACCEPTED")
      .map((row) => row.email);
    check("逐人結果保存 2 ACCEPTED／1 FAILED", accepted.length === 2 && recipientRows.filter((row) => row.status === "FAILED").length === 1);
    check("webhook 同事件重送維持一筆", followupEvents.filter((event) => event.email === EMAILS.clean && event.type === "OPENED").length === 1);
    check("OPENED 跟進排除 FAILED", resolveFollowUpEmails("OPENED", accepted, followupEvents).join(",") === EMAILS.clean);
    check("NOT_OPENED 只剩另一位 ACCEPTED", resolveFollowUpEmails("NOT_OPENED", accepted, followupEvents).join(",") === EMAILS.userUnsub);
  } finally {
    await cleanup(session.id, broadcastId);
  }

  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
