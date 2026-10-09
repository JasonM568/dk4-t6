/* 看板 4 位碼登入的限流驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 * 4 位數字只有 10,000 種組合，擋暴力嘗試全靠這張限流表：
 *   - 同 IP 連錯 5 次鎖 15 分鐘；第 6 次嘗試被擋
 *   - 失敗計數視窗過期要重算，不能永遠累積
 *   - 鎖定到期要解鎖；登入成功清掉該 IP 的計數
 *   - 分散來源掃碼：全域 100 次失敗 → 所有 IP 一起冷卻
 *   - 不同 IP 互不影響
 * 測試只動 key = ip:198.51.100.x（文件保留網段）與 global，開始與結束都清掉。
 * 跑法：npx tsx --conditions=react-server scripts/test-board-throttle-db.ts */
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

const IP_A = "198.51.100.11";
const IP_B = "198.51.100.12";
const KEYS = [`ip:${IP_A}`, `ip:${IP_B}`, "global"];
const cleanup = () => prisma.boardLoginThrottle.deleteMany({ where: { key: { in: KEYS } } });

async function main() {
  const { boardLoginBlocked, recordBoardLoginFail, clearBoardLoginFails } = await import("../src/lib/board-auth");
  const quiet = console.error;

  // 本機若剛好有真實的 global 計數，先備份、結束還原，避免影響開發中的看板
  const savedGlobal = await prisma.boardLoginThrottle.findUnique({ where: { key: "global" } });
  await cleanup();

  console.log("\n同 IP 連錯 5 次鎖定");
  for (let i = 1; i <= 4; i++) await recordBoardLoginFail(IP_A);
  check("錯 4 次：還沒鎖", !(await boardLoginBlocked(IP_A)));
  await recordBoardLoginFail(IP_A);
  check("錯第 5 次：鎖定（第 6 次嘗試會被擋）", await boardLoginBlocked(IP_A));
  const row = await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } });
  const lockMin = row?.lockedUntil ? Math.round((row.lockedUntil.getTime() - Date.now()) / 60_000) : -1;
  check("鎖定時間約 15 分鐘", lockMin >= 14 && lockMin <= 15, `實際 ${lockMin} 分鐘`);
  check("不同 IP 不受影響", !(await boardLoginBlocked(IP_B)));

  console.log("\n鎖定到期與成功登入");
  await prisma.boardLoginThrottle.update({ where: { key: `ip:${IP_A}` }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  check("鎖定時間已過：解鎖", !(await boardLoginBlocked(IP_A)));
  await clearBoardLoginFails(IP_A);
  check("登入成功清掉該 IP 的計數列", (await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } })) === null);
  for (let i = 1; i <= 4; i++) await recordBoardLoginFail(IP_A);
  check("清掉後重新計算：再錯 4 次仍未鎖", !(await boardLoginBlocked(IP_A)));

  console.log("\n失敗計數視窗過期");
  await prisma.boardLoginThrottle.update({ where: { key: `ip:${IP_A}` }, data: { windowStart: new Date(Date.now() - 16 * 60_000) } });
  await recordBoardLoginFail(IP_A);
  const fresh = await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } });
  check("視窗過期後下一次失敗從 1 重算（不是第 5 次就鎖）", fresh?.failCount === 1 && !(await boardLoginBlocked(IP_A)), `failCount=${fresh?.failCount}`);

  console.log("\n分散來源掃碼：全域冷卻");
  await cleanup();
  await prisma.boardLoginThrottle.create({ data: { key: "global", failCount: 99, windowStart: new Date() } });
  check("全域 99 次：還沒冷卻", !(await boardLoginBlocked(IP_B)));
  console.error = () => undefined; // 觸發全域冷卻時程式會 console.error 告警
  await recordBoardLoginFail(IP_B);
  console.error = quiet;
  check("全域第 100 次失敗：所有 IP 都被擋（含從沒失敗過的 IP）", (await boardLoginBlocked(IP_B)) && (await boardLoginBlocked("198.51.100.99")));
  const g = await prisma.boardLoginThrottle.findUnique({ where: { key: "global" } });
  const gMin = g?.lockedUntil ? Math.round((g.lockedUntil.getTime() - Date.now()) / 60_000) : -1;
  check("全域冷卻約 60 分鐘", gMin >= 59 && gMin <= 60, `實際 ${gMin} 分鐘`);
  await clearBoardLoginFails(IP_B);
  check("單一 IP 登入成功不會解除全域冷卻", await boardLoginBlocked("198.51.100.99"));

  await cleanup();
  if (savedGlobal) await prisma.boardLoginThrottle.create({ data: savedGlobal });
  console.log("\n  （測試資料已清理）");
}

main()
  .catch((e) => {
    fail++;
    console.error("✗ 例外：", e);
  })
  .finally(async () => {
    // 只清測試 IP；global 列已在 main() 還原，這裡不能再刪
    await prisma.boardLoginThrottle.deleteMany({ where: { key: { in: KEYS.slice(0, 2) } } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
