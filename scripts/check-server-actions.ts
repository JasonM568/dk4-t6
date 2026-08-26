/* 檢查所有 "use server" 檔案只匯出 async 函式。
 *
 * 為什麼需要這支：Next.js 對此的檢查發生在**執行期**，`next build` 會過。
 * 2026-08-26 就是這樣讓 `export const EMPTY_ATTENDEE_SEARCH` 上了正式站，
 * 整個 /admin 路由群組一載入就拋
 * 「A "use server" file can only export async functions, found object.」
 * ——build 全綠、部署成功、使用者看到錯誤頁。
 *
 * 型別（export type / interface）不算違規：編譯後會被抹掉，不會變成 action。
 *
 * 跑法：npx tsx scripts/check-server-actions.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** 第一個非空白、非註解的語句是不是 "use server" 指令 */
function isServerActionFile(src: string): boolean {
  const head = src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"))[0];
  return head === '"use server";' || head === "'use server';";
}

const OK = /^export\s+(async\s+function|type\b|interface\b)/;
// 允許 `export type { ... }` / `export { type A, type B }` 這類純型別再匯出
const TYPE_ONLY_REEXPORT = /^export\s+type\s*\{/;

let violations = 0;
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  if (!isServerActionFile(src)) continue;

  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t.startsWith("export")) return;
    if (OK.test(t) || TYPE_ONLY_REEXPORT.test(t)) return;
    violations++;
    console.error(
      `✗ ${file}:${i + 1}\n    ${t}\n    "use server" 檔案只能匯出 async 函式（型別除外）。` +
        `\n    常數／同步函式請移到一般模組（例：src/lib/…），不然這個路由一載入就會整頁失敗。`,
    );
  });
}

if (violations > 0) {
  console.error(`\n共 ${violations} 處違規`);
  process.exit(1);
}
console.log("✓ 所有 \"use server\" 檔案都只匯出 async 函式");
