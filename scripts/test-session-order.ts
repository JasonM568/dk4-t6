/* 場次手動排序的純運算驗證（離線，不碰 DB）。
 *
 * 排序寫錯的症狀是「順序悄悄亂掉」——畫面不會報錯，Jason 也不會馬上發現，
 * 而 splice 的插入索引在往下移時會因為前面先被抽掉而位移一格，正是最容易錯的點。
 *
 * 跑法：npx tsx scripts/test-session-order.ts */
import { moveByDelta, moveToTarget } from "../src/lib/session-order";

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

const L = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).join("");

console.log("\n上下箭頭：往上／往下各移一格");
{
  check("c 往上 → abcde 變 acbde", ids(moveByDelta(L, "c", -1)) === "acbde", ids(moveByDelta(L, "c", -1)));
  check("c 往下 → abcde 變 abdce", ids(moveByDelta(L, "c", 1)) === "abdce", ids(moveByDelta(L, "c", 1)));
  check("第一個往上 → 原樣", moveByDelta(L, "a", -1) === L);
  check("最後一個往下 → 原樣", moveByDelta(L, "e", 1) === L);
  check("找不到 id → 原樣", moveByDelta(L, "zzz", 1) === L);
  check("原陣列沒被就地改動", ids(L) === "abcde");
}

console.log("\n拖曳：往上拖（插在目標的位置）");
{
  check("d 拖到 b → adbce", ids(moveToTarget(L, "d", "b")) === "adbce", ids(moveToTarget(L, "d", "b")));
  check("e 拖到 a → eabcd", ids(moveToTarget(L, "e", "a")) === "eabcd", ids(moveToTarget(L, "e", "a")));
}

console.log("\n拖曳：往下拖（前面先被抽掉會位移一格，最容易寫錯的方向）");
{
  check("a 拖到 c → bcade", ids(moveToTarget(L, "a", "c")) === "bcade", ids(moveToTarget(L, "a", "c")));
  check("a 拖到 e → bcdea", ids(moveToTarget(L, "a", "e")) === "bcdea", ids(moveToTarget(L, "a", "e")));
  check("b 拖到 c → acbde", ids(moveToTarget(L, "b", "c")) === "acbde", ids(moveToTarget(L, "b", "c")));
}

console.log("\n無效操作一律原樣回傳（呼叫端據此略過寫入，不打沒必要的 DB）");
{
  check("拖到自己 → 原樣", moveToTarget(L, "c", "c") === L);
  check("來源不存在 → 原樣", moveToTarget(L, "zzz", "c") === L);
  check("目標不存在 → 原樣", moveToTarget(L, "c", "zzz") === L);
}

console.log("\n每次操作都不遺漏也不重複（順序亂掉時最該抓到的）");
{
  const cases = [
    moveByDelta(L, "c", -1),
    moveByDelta(L, "c", 1),
    moveToTarget(L, "a", "e"),
    moveToTarget(L, "e", "a"),
    moveToTarget(L, "b", "d"),
  ];
  check(
    "五種操作後都還是 5 筆、且 id 不重複",
    cases.every((r) => r.length === 5 && new Set(r.map((x) => x.id)).size === 5),
  );
  check("五種操作後的成員集合都相同", cases.every((r) => ids([...r].sort((x, y) => x.id.localeCompare(y.id))) === "abcde"));
}

console.log("\n連續操作可還原（拖下去再拖回來＝原狀）");
{
  const down = moveToTarget(L, "b", "d");
  check("b 往下拖到 d 後是 acdbe", ids(down) === "acdbe", ids(down));
  const restored = moveToTarget(down, "b", "c");
  check("再把 b 拖回 c 的位置 → abcde", ids(restored) === "abcde", ids(restored));
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
