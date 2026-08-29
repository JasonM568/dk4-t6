/* EDM Phase 1 純函式／mock provider 測試。
 * 使用本機 HTTP server 模擬 Resend，不寄真信、不碰資料庫。
 * 跑法：npx tsx --conditions=react-server scripts/test-edm-delivery.ts */
import { createServer } from "node:http";
import { once } from "node:events";
import { resolveFollowUpEmails } from "../src/lib/email/followup";
import { resolveMessageType } from "../src/lib/email/message-type";

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

const attempts = new Map<string, number>();
const server = createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const messages = JSON.parse(raw) as { subject: string }[];
    const scenario = messages[0]?.subject ?? "";
    const count = (attempts.get(scenario) ?? 0) + 1;
    attempts.set(scenario, count);

    if (scenario === "partial") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "m-1" }, { id: "m-2" }, { error: "bad" }] }));
      return;
    }
    if (scenario === "retry-429" && count === 1) {
      res.writeHead(429, { "retry-after": "0.001" });
      res.end("rate limited");
      return;
    }
    if (scenario === "fail-500") {
      res.writeHead(500);
      res.end("provider down");
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: messages.map((_, i) => ({ id: `${scenario}-${i + 1}` })),
      }),
    );
  });
});

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server 無 port");

  process.env.RESEND_BATCH_URL = `http://127.0.0.1:${address.port}`;
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "Test <test@example.com>";
  // URL 在 broadcast 模組載入時固定，因此必須在設定 env 後 dynamic import。
  const { buildBroadcastHtml, sendBroadcast } = await import("../src/lib/email/broadcast");
  const recipients = ["a@example.com", "b@example.com", "c@example.com"].map(
    (email) => ({ email }),
  );

  console.log("\n行銷／履約通知預覽文案");
  const marketingHtml = buildBroadcastHtml("內容", null, "https://x.test/u", "MARKETING");
  const noticeHtml = buildBroadcastHtml("內容", null, "https://x.test/u", "NOTICE");
  check("MARKETING 顯示一般退訂文案", marketingHtml.includes("不想再收到這類信件？") && !marketingHtml.includes("上課通知仍會寄送"));
  check("NOTICE 說明退訂不影響上課通知", noticeHtml.includes("上課通知仍會寄送") && noticeHtml.includes("取消訂閱"));

  console.log("\n部分成功逐筆結果");
  const partial = await sendBroadcast(recipients, "partial", () => "<p>x</p>");
  check("2 筆 ACCEPTED", partial.acceptedRecipients.length === 2);
  check("message id 與 email 對應", partial.acceptedRecipients[1]?.providerMessageId === "m-2" && partial.acceptedRecipients[1]?.email === "b@example.com");
  check("1 筆 FAILED 且有原因", partial.failedRecipients.length === 1 && partial.failedRecipients[0]?.email === "c@example.com" && !!partial.failedRecipients[0]?.reason);
  check("彙總為成功 2／失敗 1", partial.sent === 2 && partial.failed === 1);

  console.log("\n429 重試後成功");
  const retry = await sendBroadcast(recipients.slice(0, 1), "retry-429", () => "<p>x</p>");
  check("429 共嘗試 2 次", attempts.get("retry-429") === 2);
  check("重試成功只回一筆 ACCEPTED", retry.sent === 1 && retry.acceptedRecipients.length === 1 && retry.failed === 0);

  console.log("\n5xx 用盡重試");
  const exhausted = await sendBroadcast(recipients.slice(0, 2), "fail-500", () => "<p>x</p>");
  check("5xx 共嘗試 3 次", attempts.get("fail-500") === 3);
  check("整批皆 FAILED", exhausted.sent === 0 && exhausted.failed === 2 && exhausted.failedRecipients.length === 2);
  check("整批失敗原因可讀", exhausted.failedRecipients.every((r) => r.reason.includes("Resend 500")));

  console.log("\n跟進名單只使用 ACCEPTED 母集合");
  const accepted = ["opened@example.com", "clicked@example.com", "quiet@example.com", "bounce@example.com"];
  const events = [
    { email: "opened@example.com", type: "OPENED" },
    { email: "clicked@example.com", type: "OPENED" },
    { email: "clicked@example.com", type: "CLICKED" },
    { email: "bounce@example.com", type: "BOUNCED" },
    // 模擬 FAILED 地址意外出現事件，也不得進跟進信。
    { email: "failed@example.com", type: "OPENED" },
    { email: "failed@example.com", type: "CLICKED" },
  ];
  check("OPENED 排除 FAILED", resolveFollowUpEmails("OPENED", accepted, events).join(",") === "opened@example.com,clicked@example.com");
  check("CLICKED 排除 FAILED", resolveFollowUpEmails("CLICKED", accepted, events).join(",") === "clicked@example.com");
  check("OPENED_NOT_CLICKED 正確", resolveFollowUpEmails("OPENED_NOT_CLICKED", accepted, events).join(",") === "opened@example.com");
  check("NOT_OPENED 扣除開信與退信", resolveFollowUpEmails("NOT_OPENED", accepted, events).join(",") === "quiet@example.com");

  console.log("\n履約通知 audience 守門");
  check("ALL 不得標 NOTICE", !!resolveMessageType("all", true, true).error);
  check("GROUP 不得標 NOTICE", !!resolveMessageType("group", true, true).error);
  check("FOLLOWUP 不得標 NOTICE", !!resolveMessageType("followup", true, true).error);
  check("SESSION 未確認不得寄", !!resolveMessageType("session", true, false).error);
  check("SESSION 確認後為 NOTICE", resolveMessageType("session", true, true).messageType === "NOTICE");
  check("未要求履約通知維持 MARKETING", resolveMessageType("all", false, false).messageType === "MARKETING");

  console.log(fail === 0 ? `\n全部通過（${pass} 項）` : `\n${fail} 項失敗（${pass} 項通過）`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
