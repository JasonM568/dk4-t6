/* 看板 4 位碼登入的限流驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 * 4 位數字只有 10,000 種組合，擋暴力嘗試全靠這張限流表。R10 起採『先預約再比對』的原子模型：
 *   每次嘗試『先』呼叫 reserveBoardLoginAttempt(ip) 預約額度——
 *   - 同 IP 5 次內放行（回 false＝還能試），第 6 次嘗試當下寫入 lockedUntil（≈15 分）並擋（回 true）
 *   - 併發也一樣：30 個同時進來，恰好 5 個放行
 *   - 視窗過期要重算；鎖定到期要解鎖；登入成功清掉該 IP 的計數
 *   - 分散來源掃碼：全域第 100 次仍放行、第 101 次所有 IP 一起被擋（≈60 分冷卻）
 *   - 不同 IP 互不影響；單一 IP 登入成功不解除全域冷卻
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

const IP_A = `198.51.100.${process.pid}-a`;
const IP_B = `198.51.100.${process.pid}-b`;
const IP_C = `198.51.100.${process.pid}-c`;
const IP_D = `198.51.100.${process.pid}-d`;
const KEYS = [`ip:${IP_A}`, `ip:${IP_B}`, `ip:${IP_C}`, `ip:${IP_D}`, "global"];
const cleanup = () => prisma.boardLoginThrottle.deleteMany({ where: { key: { in: KEYS } } });
const minutesLeft = (d: Date | null | undefined) => (d ? Math.round((d.getTime() - Date.now()) / 60_000) : -1);

async function main() {
  const { reserveBoardLoginAttempt, boardLoginBlocked, clearBoardLoginFails } = await import("../src/lib/board-auth");
  const quiet = console.error;

  // 本機若剛好有真實的 global 計數，先備份、結束還原，避免影響開發中的看板
  const savedGlobal = await prisma.boardLoginThrottle.findUnique({ where: { key: "global" } });
  await cleanup();

  console.log("\n同 IP：5 次內放行，第 6 次當下鎖定（預約語意）");
  const first5: boolean[] = [];
  for (let i = 1; i <= 5; i++) first5.push(await reserveBoardLoginAttempt(IP_A));
  check("第 1～5 次預約都放行（回 false＝還能嘗試）", first5.every((x) => x === false), JSON.stringify(first5));
  check("5 次之後唯讀檢查（boardLoginBlocked）仍是未鎖", !(await boardLoginBlocked(IP_A)));
  const sixth = await reserveBoardLoginAttempt(IP_A);
  check("第 6 次預約被擋（回 true），這一次不會進入比對，連輸對的碼也進不去", sixth === true);
  check("第 6 次當下寫入鎖定，唯讀檢查變 true", await boardLoginBlocked(IP_A));
  const row = await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } });
  const lockMin = minutesLeft(row?.lockedUntil);
  check("鎖定時間以第 6 次當下起算，約 15 分鐘", lockMin >= 14 && lockMin <= 15, `實際 ${lockMin} 分鐘`);
  check("鎖定期間每次預約都被擋", (await reserveBoardLoginAttempt(IP_A)) === true && (await reserveBoardLoginAttempt(IP_A)) === true);
  check("不同 IP 不受影響", (await reserveBoardLoginAttempt(IP_B)) === false);

  console.log("\n鎖定到期、視窗過期與登入成功");
  await prisma.boardLoginThrottle.update({ where: { key: `ip:${IP_A}` }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  check("鎖定時間已過：下一次預約放行，計數從 1 重新開始", (await reserveBoardLoginAttempt(IP_A)) === false && (await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } }))?.failCount === 1);
  await clearBoardLoginFails(IP_A);
  check("登入成功清掉該 IP 的計數列", (await prisma.boardLoginThrottle.findUnique({ where: { key: `ip:${IP_A}` } })) === null);
  const again: boolean[] = [];
  for (let i = 1; i <= 6; i++) again.push(await reserveBoardLoginAttempt(IP_A));
  check("清掉後重新計算：再 5 次放行、第 6 次被擋", JSON.stringify(again) === JSON.stringify([false, false, false, false, false, true]), JSON.stringify(again));

  await prisma.boardLoginThrottle.deleteMany({ where: { key: `ip:${IP_C}` } });
  for (let i = 1; i <= 4; i++) await reserveBoardLoginAttempt(IP_C);
  await prisma.boardLoginThrottle.update({ where: { key: `ip:${IP_C}` }, data: { windowStart: new Date(Date.now() - 16 * 60_000) } });
  const afterWindow: boolean[] = [];
  for (let i = 1; i <= 6; i++) afterWindow.push(await reserveBoardLoginAttempt(IP_C));
  check("視窗過期（15 分鐘前就開始計）：計數重算，之後仍是 5 次放行、第 6 次被擋（不是第 2 次就鎖）", JSON.stringify(afterWindow) === JSON.stringify([false, false, false, false, false, true]), JSON.stringify(afterWindow));

  console.log("\n併發：同一 IP 一次進來 30 個，恰好 5 個放行");
  const burst = await Promise.all(Array.from({ length: 30 }, () => reserveBoardLoginAttempt(IP_D)));
  const allowed = burst.filter((x) => x === false).length;
  check("30 個併發預約 → 恰好 5 個放行、25 個被擋（原子計數，併發繞不過）", allowed === 5, `放行 ${allowed} 個`);

  console.log("\n分散來源掃碼：全域冷卻");
  await prisma.boardLoginThrottle.deleteMany({ where: { key: "global" } });
  await prisma.boardLoginThrottle.create({ data: { key: "global", failCount: 99, windowStart: new Date() } });
  console.error = () => undefined; // 觸發全域冷卻時程式會 console.error 告警
  const g100 = await reserveBoardLoginAttempt(IP_B);
  check("全域第 100 次仍放行", g100 === false);
  const g101 = await reserveBoardLoginAttempt(IP_B);
  check("全域第 101 次：被擋", g101 === true);
  check("全域鎖定後，從沒出現過的 IP 也一起被擋", (await reserveBoardLoginAttempt(`${IP_B}-never-seen`)) === true);
  console.error = quiet;
  const g = await prisma.boardLoginThrottle.findUnique({ where: { key: "global" } });
  const gMin = minutesLeft(g?.lockedUntil);
  check("全域冷卻約 60 分鐘", gMin >= 59 && gMin <= 60, `實際 ${gMin} 分鐘`);
  await clearBoardLoginFails(IP_B);
  check("單一 IP 登入成功（清自己的計數）不會解除全域冷卻", await boardLoginBlocked("198.51.100.99"));

  await cleanup();
  await prisma.boardLoginThrottle.deleteMany({ where: { key: `ip:${IP_B}-never-seen` } });
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
    await prisma.boardLoginThrottle.deleteMany({ where: { key: { in: KEYS.slice(0, 4) } } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
