/* EDM 逐連結 webhook 冪等測試；只允許 localhost DB，測後清理。 */
import { prisma } from "../src/lib/db";
import { recordBroadcastLinkClick } from "../src/lib/email/link-event";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("✗ DATABASE_URL 不是本機，拒絕執行");
  process.exit(1);
}
const broadcastId = "edm-phase2-link-test";
const email = "edm-link-test@example.com";
const svixIds = ["edm-link-svix-1", "edm-link-svix-2", "edm-link-svix-invalid"];
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
async function cleanup() {
  await prisma.broadcastLinkEvent.deleteMany({ where: { broadcastId } });
  await prisma.webhookReceipt.deleteMany({ where: { svixId: { in: svixIds } } });
}
async function main() {
  await cleanup();
  try {
    const first = await recordBroadcastLinkClick({ svixId: svixIds[0], eventType: "email.clicked", broadcastId, email, link: "https://example.com/path?a=1", timestamp: "2026-08-29T01:00:00.000Z" });
    const duplicate = await recordBroadcastLinkClick({ svixId: svixIds[0], eventType: "email.clicked", broadcastId, email, link: "https://example.com/path?a=1", timestamp: "2026-08-29T01:01:00.000Z" });
    const second = await recordBroadcastLinkClick({ svixId: svixIds[1], eventType: "email.clicked", broadcastId, email, link: "https://example.com/path?a=1", timestamp: "2026-08-29T01:02:00.000Z" });
    const invalid = await recordBroadcastLinkClick({ svixId: svixIds[2], eventType: "email.clicked", broadcastId, email, link: "javascript:alert(1)", timestamp: null });
    const rows = await prisma.broadcastLinkEvent.findMany({ where: { broadcastId } });
    check("首次點擊 recorded", first === "recorded");
    check("同 svix-id 為 duplicate", duplicate === "duplicate");
    check("不同 webhook 同 URL 會累加", second === "recorded" && rows[0]?.clickCount === 2);
    check("同人同 URL 維持一列", rows.length === 1);
    check("首次時間不被覆蓋", rows[0]?.firstClickedAt.toISOString() === "2026-08-29T01:00:00.000Z");
    check("最後時間更新", rows[0]?.lastClickedAt.toISOString() === "2026-08-29T01:02:00.000Z");
    check("非法 URL 不寫入", invalid === "invalid" && rows.length === 1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n通過 ${pass}、失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (error) => { console.error(error); await cleanup(); await prisma.$disconnect(); process.exit(1); });
