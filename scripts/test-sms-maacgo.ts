// MAAC Go adapter 驗證：本機 mock server 模擬 API 回應，不打真端點、不花錢。
//
//   npx tsx --conditions=react-server scripts/test-sms-maacgo.ts
//
// 情境依收件號碼分流：成功 / 餘額不足 / NCC 擋 / 429 退避後成功 / 非 JSON 回應。
import { createServer } from "node:http";
import { MaacGoProvider } from "../src/lib/sms/provider/maacgo";

let ok = 0;
let bad = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "✅" : "❌"} ${label}：${JSON.stringify(actual)}${pass ? "" : ` ← 預期 ${JSON.stringify(expected)}`}`);
  pass ? ok++ : bad++;
}

const PORT = 4020;
let hit429 = 0;
let lastAuth = "";
let lastBody: Record<string, unknown> = {};

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastAuth = String(req.headers.authorization ?? "");
    const body = JSON.parse(raw) as { to?: string };
    lastBody = body as Record<string, unknown>;
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    switch (body.to) {
      case "0912111111":
        return send(200, { ok: true, message_id: "sms_ok_1", status: "queued", segments: 1, cost_cents: 78 });
      case "0912222222":
        return send(402, { error: "insufficient_balance", balance_cents: 30, topup_url: "https://x" });
      case "0912333333":
        return send(400, { error: "ncc_blocked", issues: [{ level: "block", code: "SHORTENER", reason: "bit.ly 在 NCC 封鎖清單" }] });
      case "0912444444":
        if (hit429++ === 0) {
          res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
          return res.end(JSON.stringify({ error: "rate_limited" }));
        }
        return send(200, { ok: true, message_id: "sms_ok_2", status: "queued" });
      case "0912555555":
        res.writeHead(500, { "content-type": "text/plain" });
        return res.end("boom"); // 5xx + 非 JSON：重試耗盡後走 HTTP fallback 文案
      default:
        return send(400, { error: "invalid_phone" });
    }
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(PORT, r));

  const live = new MaacGoProvider({ apiKey: "sk_live_x", apiBase: `http://localhost:${PORT}` });
  const test = new MaacGoProvider({ apiKey: "sk_test_x", apiBase: `http://localhost:${PORT}`, team: "課程平台" });

  check("sk_live 視為 isLive", live.isLive, true);
  check("sk_test 非 live", test.isLive, false);
  check("sk_test label 有標示", test.label.includes("不實際發送"), true);

  const r1 = await test.send([{ mobile: "0912111111", text: "【希望學院】測試" }]);
  check("成功取回 message_id", r1, [{ ok: true, messageId: "sms_ok_1" }]);
  check("Bearer 帶對 key", lastAuth, "Bearer sk_test_x");
  check("team 有帶", lastBody.team, "課程平台");
  check("type 為 notification", lastBody.type, "notification");

  const r2 = await test.send([
    { mobile: "0912222222", text: "x" },
    { mobile: "0912333333", text: "x" },
  ]);
  check("餘額不足中文原因", (r2[0] as { reason: string }).reason.includes("餘額不足"), true);
  check("NCC 擋含原因", (r2[1] as { reason: string }).reason.includes("NCC") && (r2[1] as { reason: string }).reason.includes("封鎖清單"), true);
  check("逐筆對應長度", r2.length, 2);

  const t0 = Date.now();
  const r3 = await test.send([{ mobile: "0912444444", text: "x" }]);
  check("429 退避後成功", r3, [{ ok: true, messageId: "sms_ok_2" }]);
  check("有等 Retry-After（≥1s）", Date.now() - t0 >= 1000, true);

  const r4 = await test.send([{ mobile: "0912555555", text: "x" }]);
  check("5xx 耗盡回 HTTP fallback", (r4[0] as { reason: string }).reason.includes("HTTP 500"), true);

  // 憑證缺漏：不 throw、逐筆回失敗（/admin/sms 頁面不能 500）
  const noKey = new MaacGoProvider({ apiKey: "", apiBase: `http://localhost:${PORT}` });
  check("無憑證 label 標示", noKey.label.includes("憑證未設定"), true);
  check("無憑證非 live", noKey.isLive, false);
  const r5 = await noKey.send([{ mobile: "0912111111", text: "x" }, { mobile: "0912222222", text: "x" }]);
  check("無憑證逐筆失敗不打 API", r5.map((r) => r.ok), [false, false]);
  check("無憑證原因可讀", (r5[0] as { reason: string }).reason.includes("MAACGO_API_KEY"), true);

  server.close();
  console.log(`\n結果：${ok} 通過、${bad} 失敗`);
  if (bad > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
