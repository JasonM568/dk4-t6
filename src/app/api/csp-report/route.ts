import { prisma } from "@/lib/db";

// CSP 違規收集端點（Report-Only 觀察期用）。
//
// 這是無需登入的公開端點——瀏覽器送違規報告時不會帶 cookie，也不能要求驗證。
// 因此防線放在「寫入什麼」而不是「誰能寫」：
//   1. 只收兩種標準 content-type、限制 body 大小
//   2. 欄位截斷、只留 documentURL 的 pathname（不留 query，避免把 token 收進 DB）
//   3. 瀏覽器擴充套件造成的違規直接丟棄（chrome-extension:// 之類，佔實務上多數噪音）
//   4. 同一組 directive+來源+頁面只累加次數；不同組合達上限後不再新增列，防灌爆
//
// 觀察方式：直接查 course."CspReport"，依 count 排序看有哪些來源會被完整白名單擋掉。

const MAX_BODY_BYTES = 32 * 1024;
const MAX_FIELD_CHARS = 200;
const MAX_DISTINCT_ROWS = 500;
const ACCEPTED_TYPES = ["application/csp-report", "application/reports+json", "application/json"];
const IGNORED_SCHEMES = /^(chrome|moz|safari|webkit|ms-browser)-extension:|^about:|^chrome:/i;

const trim = (v: unknown) =>
  typeof v === "string" ? v.trim().slice(0, MAX_FIELD_CHARS) : "";

/** 只留 path，丟掉 query／hash——網址上可能帶 token 或個資，不該進 DB */
function toPath(raw: unknown) {
  const value = trim(raw);
  if (!value) return "";
  try {
    return new URL(value).pathname.slice(0, MAX_FIELD_CHARS);
  } catch {
    return value.split(/[?#]/)[0];
  }
}

/** report-uri 與 report-to 兩種格式的欄位名不同，這裡統一 */
function normalize(entry: Record<string, unknown>) {
  const body = (entry["csp-report"] ?? entry.body ?? entry) as Record<string, unknown>;
  const directive = trim(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? body.violatedDirective);
  const blockedUri = trim(body["blocked-uri"] ?? body.blockedURL ?? body.blockedURI);
  const documentPath = toPath(body["document-uri"] ?? body.documentURL ?? body.documentURI);
  return { directive, blockedUri, documentPath };
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!ACCEPTED_TYPES.some((t) => type.includes(t))) return new Response(null, { status: 415 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  // report-to 送陣列、report-uri 送單一物件
  const entries = (Array.isArray(payload) ? payload : [payload]).slice(0, 20);

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { directive, blockedUri, documentPath } = normalize(entry as Record<string, unknown>);
    if (!directive || !blockedUri) continue;
    if (IGNORED_SCHEMES.test(blockedUri)) continue;

    try {
      const existing = await prisma.cspReport.findUnique({
        where: { directive_blockedUri_documentPath: { directive, blockedUri, documentPath } },
        select: { id: true },
      });
      if (existing) {
        await prisma.cspReport.update({
          where: { id: existing.id },
          data: { count: { increment: 1 }, lastSeenAt: new Date() },
        });
        continue;
      }
      if ((await prisma.cspReport.count()) >= MAX_DISTINCT_ROWS) break;
      await prisma.cspReport.create({ data: { directive, blockedUri, documentPath } });
    } catch (e) {
      // 收集失敗不該讓瀏覽器重試或噴錯，記 log 就好
      console.error("[csp-report] 寫入失敗", e);
    }
  }

  return new Response(null, { status: 204 });
}
