/* EDM 課前通知「已通知」回寫的整合測試（會寫入資料庫，**只能對本機 localhost 跑**；
 * 寄信走本機 mock provider，絕不碰 Resend）。
 *
 * 走正式的 executeBroadcast，驗三條規則（與簡訊模組同款）：
 *   1. 只標記 provider 接受的人；送失敗的維持未通知，下次「只寄還沒收到的人」會撈回來
 *   2. 同一個信箱對到多筆（訂購人幫同行者填自己的信箱）→ 一封信通知到全部，一起標記
 *   3. 回寫之後再用 PENDING 試算，只剩失敗的那一位
 * 跑法：npx tsx --conditions=react-server scripts/test-edm-notice-writeback-db.ts */
import { createServer } from "node:http";
import { once } from "node:events";

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

// mock provider：收件人是 fail@ 的那封回 error，其餘回 id（Resend batch 回應格式）
const server = createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const messages = JSON.parse(raw) as { to: string | string[] }[];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      data: messages.map((m, i) => {
        const to = Array.isArray(m.to) ? m.to.join(",") : String(m.to);
        return to.includes("fail@") ? { error: "mailbox rejected" } : { id: `wb-${i + 1}` };
      }),
    }));
  });
});

const SID = "test-edm-writeback-session";

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server 無 port");
  process.env.RESEND_BATCH_URL = `http://127.0.0.1:${address.port}`;
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "Test <test@example.com>";
  // provider URL 在模組載入時固定，必須先設 env 再 dynamic import
  const { prisma } = await import("../src/lib/db");
  const { executeBroadcast, previewSessionAudience } = await import("../src/lib/email/dispatch");

  const cleanup = async () => {
    const bs = await prisma.emailBroadcast.findMany({ where: { subject: "wb-test" }, select: { id: true } });
    await prisma.emailBroadcastRecipient.deleteMany({ where: { broadcastId: { in: bs.map((b) => b.id) } } });
    await prisma.emailBroadcast.deleteMany({ where: { subject: "wb-test" } });
    await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
    await prisma.courseSession.deleteMany({ where: { id: SID } });
  };
  await cleanup();
  await prisma.courseSession.create({ data: { id: SID, title: "測試場次－EDM 回寫", keywords: ["測試回寫"] } });
  await prisma.sessionSignup.createMany({
    data: [
      { sessionId: SID, orderNo: "W-1", attendeeKey: "buyer", name: "成功甲", phone: "0900000201", email: "ok1@example.com" },
      { sessionId: SID, orderNo: "W-2", attendeeKey: "buyer", name: "訂購人乙", phone: "0900000202", email: "ok2@example.com" },
      { sessionId: SID, orderNo: "W-2", attendeeKey: "companion", name: "同行者丙", phone: "0900000203", email: "ok2@example.com" },
      { sessionId: SID, orderNo: "W-3", attendeeKey: "buyer", name: "退信丁", phone: "0900000204", email: "fail@example.com" },
    ],
  });
  const b = await prisma.emailBroadcast.create({
    data: {
      subject: "wb-test", body: "{name} 你好，課前提醒。", audienceType: "SESSION", sessionIds: [SID],
      messageType: "NOTICE", noticeScope: "PENDING", status: "SENDING",
    },
    select: { id: true },
  });

  console.log("\n寄出（mock provider：fail@ 那封回錯誤）");
  const r = await executeBroadcast(b.id);
  check("provider 接受 2 封（ok1、ok2 去重後一封）", r.sent === 2, `實得 ${r.sent}`);
  check("失敗 1 封", r.failed === 1, `實得 ${r.failed}`);

  console.log("\n回寫 emailNoticeAt");
  const rows = await prisma.sessionSignup.findMany({ where: { sessionId: SID }, select: { name: true, email: true, emailNoticeAt: true } });
  const at = (n: string) => rows.find((x) => x.name === n)?.emailNoticeAt;
  check("成功甲已標記", !!at("成功甲"));
  check("訂購人乙已標記", !!at("訂購人乙"));
  check("同行者丙（同信箱）一起標記——一封信通知到全部", !!at("同行者丙"));
  check("退信丁維持未通知（provider 拒收）", !at("退信丁"));

  console.log("\n再用「只寄還沒收到的人」試算");
  const pend = await previewSessionAudience([SID], "NOTICE", "PENDING");
  check("只剩退信丁 1 位會被撈回來", pend.uniqueCount === 1, `實得 ${pend.uniqueCount}`);
  const all = await previewSessionAudience([SID], "NOTICE", "ALL");
  check("全部範圍仍 3 位（不受回寫影響）", all.uniqueCount === 3, `實得 ${all.uniqueCount}`);

  console.log("\n群發紀錄狀態");
  const rec = await prisma.emailBroadcast.findUnique({ where: { id: b.id }, select: { status: true, sentCount: true, failedCount: true } });
  check("紀錄 SENT、sentCount=2、failedCount=1", rec?.status === "SENT" && rec.sentCount === 2 && rec.failedCount === 1, JSON.stringify(rec));

  await cleanup();
  await prisma.$disconnect();
  server.close();
  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); server.close(); process.exit(1); });
