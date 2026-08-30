/**
 * open redirect 防線回歸測試
 * 執行：npx tsx scripts/test-safe-redirect.ts
 *
 * safeNextPath 只放行本站相對路徑。重點是擋掉反斜線繞過 /\evil.com——
 * 舊寫法 startsWith("/") && !startsWith("//") 會放行它，而 WHATWG URL parser
 * 把反斜線正規化成斜線後就跳去外站。這支測試把已知繞過向量全列進來，任何回歸都會紅。
 */
import { safeNextPath } from "../src/lib/safe-redirect";

// [輸入, 期望輸出(預設 fallback=/dashboard)]
const cases: [unknown, string][] = [
  // 合法站內路徑：原樣（或正規化後）通過
  ["/dashboard", "/dashboard"],
  ["/orders/abc?x=1", "/orders/abc?x=1"],
  ["/path#frag", "/path#frag"],
  ["/a/b/c", "/a/b/c"],
  // open redirect 向量：一律退回 fallback
  ["//evil.com", "/dashboard"],
  ["/\\evil.com", "/dashboard"], // 反斜線繞過（核心）
  ["/\\/evil.com", "/dashboard"],
  ["\\/evil.com", "/dashboard"],
  ["https://evil.com", "/dashboard"],
  ["http://evil.com", "/dashboard"],
  ["javascript:alert(1)", "/dashboard"],
  ["\t/\\evil.com", "/dashboard"], // 前置空白 + 反斜線
  ["/\t/\\evil.com", "/dashboard"],
  // 邊界：空 / 非字串 / 裸斜線 → fallback
  ["", "/dashboard"],
  ["/", "/dashboard"],
  [null, "/dashboard"],
  [undefined, "/dashboard"],
  [123, "/dashboard"],
];

let pass = 0;
let fail = 0;
for (const [input, expected] of cases) {
  const got = safeNextPath(input);
  const ok = got === expected;
  if (ok) pass++;
  else {
    fail++;
    console.error(
      `FAIL  input=${JSON.stringify(input)}  got=${JSON.stringify(got)}  expected=${JSON.stringify(expected)}`,
    );
  }
}

// 自訂 fallback
const fb = safeNextPath("//evil.com", "/login");
if (fb !== "/login") {
  fail++;
  console.error(`FAIL  custom fallback  got=${JSON.stringify(fb)}  expected="/login"`);
} else pass++;

console.log(`\nsafe-redirect: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
