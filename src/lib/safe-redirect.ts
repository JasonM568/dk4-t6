/** open redirect 防線：只放行「本站相對路徑」，回傳正規化後可安全 redirect 的路徑。
 *
 *  舊寫法 `raw.startsWith("/") && !raw.startsWith("//")`（或等價 regex）擋得住 `//evil.com`，
 *  但擋不住 `/\evil.com`——WHATWG URL parser 會把反斜線正規化成斜線，
 *  `new URL("/\\evil.com", base)` 直接跳去 `https://evil.com/`（已實測）。
 *
 *  這裡雙重防線：
 *   1. 必須「單一正斜線 + 非斜線非反斜線」開頭，擋掉 `//`、`/\`、以及任何非 `/` 開頭字串
 *   2. 用固定 base 實際解析，origin 有變（被導去外站）就退回 fallback
 *  回傳正規化後的 `pathname + search + hash`，呼叫端可安心 redirect。 */
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  if (!/^\/[^/\\]/.test(raw)) return fallback;
  try {
    const base = "https://internal.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
