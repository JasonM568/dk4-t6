/* 簡訊送達追蹤端到端驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 * 用本地假 API 模擬 MAAC Go 的 /sms/list 與 /sms/{id} 回應（欄位形狀取自實際回傳），
 * 驗證：狀態對應、逐筆更新、彙總回寫、拒收自動進退訂名單。
 * 跑法：npx tsx --conditions=react-server scripts/test-sms-delivery-db.ts
 *（dispatch.ts 是 server-only，純 node 條件下該套件會 throw） */
import { createServer } from "node:http";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
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

// 假簡訊商：欄位名與 sms.cresclab.com 實際回傳一致
const FAKE: Record<string, { status: string; delivered_at: string | null; error: string | null }> = {
  "sms_delivered1": { status: "delivered", delivered_at: "2026-08-14T08:09:36.000Z", error: null },
  "sms_failed1": { status: "failed", delivered_at: null, error: "invalid_phone_number" },
  "sms_stop1": { status: "stop", delivered_at: null, error: null },
  "sms_pending1": { status: "sent", delivered_at: null, error: null },
};

async function main() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/sms/list") {
      // 只回其中兩筆：另外兩筆要走「逐筆補查 GET /sms/{id}」路徑
      res.end(JSON.stringify({
        ok: true,
        messages: ["sms_delivered1", "sms_failed1"].map((id) => ({
          id, to_phone: "09xxxxxxxx", segments: 1, cost_cents: 78, ...FAKE[id],
        })),
      }));
      return;
    }
    const id = url.pathname.replace("/sms/", "");
    if (FAKE[id]) {
      res.end(JSON.stringify({ id, segments: 1, cost_cents: 78, ...FAKE[id] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  // provider 由環境變數決定且有快取：設好再 import dispatch
  process.env.SMS_PROVIDER = "maacgo";
  process.env.MAACGO_API_KEY = "sk_test_fake";
  process.env.MAACGO_API_BASE = `http://127.0.0.1:${port}`;
  const { resetSmsProviderCache } = await import("../src/lib/sms/provider");
  resetSmsProviderCache();
  const { refreshSmsDelivery } = await import("../src/lib/sms/dispatch");

  const b = await prisma.smsBroadcast.create({
    data: {
      title: "送達追蹤測試", body: "test", status: "SENT", provider: "maacgo",
      sentCount: 4, sentAt: new Date(),
      messages: {
        create: [
          { mobile: "0911111111", name: "已送達", providerMessageId: "sms_delivered1", status: "SENT" },
          { mobile: "0922222222", name: "失敗", providerMessageId: "sms_failed1", status: "SENT" },
          { mobile: "0933333333", name: "拒收", providerMessageId: "sms_stop1", status: "SENT" },
          { mobile: "0944444444", name: "待回報", providerMessageId: "sms_pending1", status: "SENT" },
        ],
      },
    },
  });

  try {
    const r = await refreshSmsDelivery(b.id);
    const rows = await prisma.smsMessage.findMany({
      where: { broadcastId: b.id }, orderBy: { mobile: "asc" },
    });
    const byMobile = Object.fromEntries(rows.map((x) => [x.mobile, x]));
    const after = await prisma.smsBroadcast.findUnique({ where: { id: b.id } });

    console.log("— 狀態對應 —");
    check("查了 4 筆、更新 4 筆", r.checked === 4 && r.updated === 4, JSON.stringify(r));
    check("delivered → 已送達，且帶回送達時間",
      byMobile["0911111111"].status === "DELIVERED" && !!byMobile["0911111111"].deliveredAt);
    check("failed → 失敗，錯誤碼轉成中文",
      byMobile["0922222222"].status === "FAILED" &&
      byMobile["0922222222"].error === "號碼無效（空號、停用或非行動電話）",
      byMobile["0922222222"].error ?? "");
    check("stop → 拒收", byMobile["0933333333"].status === "STOP");
    check("仍在途中的維持已送出（不亂判失敗）", byMobile["0944444444"].status === "SENT");
    check("逐筆補查有生效（list 只回 2 筆，其餘走 GET /sms/{id}）",
      byMobile["0933333333"].checkedAt !== null);

    console.log("— 彙總與退訂 —");
    check("送達數彙總回 broadcast", after?.deliveredCount === 1, String(after?.deliveredCount));
    check("失敗數 = 失敗 + 拒收", after?.failedCount === 2, String(after?.failedCount));
    const optOut = await prisma.smsOptOut.findUnique({ where: { mobile: "0933333333" } });
    check("拒收者自動進退訂名單", !!optOut && optOut.reason === "簡訊回覆拒收");

    console.log("— 再查一次不會重複更新 —");
    const again = await refreshSmsDelivery(b.id);
    check("已定案的不再查詢（只剩待回報那筆）", again.checked === 1, JSON.stringify(again));
  } finally {
    await prisma.smsBroadcast.delete({ where: { id: b.id } });
    await prisma.smsOptOut.deleteMany({ where: { mobile: "0933333333" } });
    server.close();
  }

  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main();
