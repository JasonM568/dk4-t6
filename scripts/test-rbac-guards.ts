/* 後台權限與越權（RBAC）守門驗證——靜態掃描＋純函式，不寫資料庫。
 *
 * 測什麼：
 *   1. role.ts 三級角色能力矩陣（含 null、亂填的字串）
 *   2. src/actions/*.ts 每個匯出的 server action：除了明列的「公開入口」，都必須在
 *      第一次寫入前先過 requireStaff/requireEditor/requireFullAdmin（或會呼叫它們的區域 helper）。
 *      server action 可以被任何人直接 POST，前端藏按鈕不算守門。
 *   3. src/app/api/admin/**／route.ts：後台匯出端點必須有守門；金流／webhook／cron 必須有驗簽或密鑰
 *   4. 僅限管理員的頁面（收支、權限、設定）必須用 pageGuardFullAdmin／requireFullAdmin
 *   5. (admin)/layout 擋非後台角色；proxy matcher 涵蓋 /admin
 *   6. 看板 token：竄改、逾時、換碼、格式錯誤、secret 過短、版本不符
 *
 * 跑法：npx tsx --conditions=react-server scripts/test-rbac-guards.ts
 * 導入 lib/db 後立刻檢查 localhost（本檔不寫資料庫，守門只是保險）。 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行");
  process.exit(1);
}
void prisma;

import {
  canAccessAdmin,
  canEdit,
  isFullAdmin,
  isAdminRole,
  type StaffRole,
} from "../src/lib/auth/role";

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

const ROOT = process.env.QA_ROOT ?? process.cwd(); // 預設 repo 根目錄；QA_ROOT 供變異驗證用
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const GUARD_RE = /\b(requireStaff|requireEditor|requireFullAdmin)\s*\(/;
const WRITE_RE =
  /\b(prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)|prisma\.\$transaction|prisma\.\$executeRaw|prisma\.\$queryRaw)\b/;

// ───────────────────── 1. 角色能力矩陣 ─────────────────────
console.log("\n1. 角色能力矩陣");
{
  const roles: (StaffRole | null)[] = ["admin", "operator", "coach", null];
  const expect: Record<string, [boolean, boolean, boolean]> = {
    admin: [true, true, true],
    operator: [true, true, false],
    coach: [true, false, false],
    null: [false, false, false],
  };
  for (const r of roles) {
    const [a, e, f] = expect[String(r)];
    check(`${r}: 進後台=${a} 可編輯=${e} 僅管理員=${f}`,
      canAccessAdmin(r) === a && canEdit(r) === e && isFullAdmin(r) === f);
  }
  const junk = ["ADMIN", "Admin ", "root", "", "operator", "coach"] as unknown as StaffRole[];
  check("亂填的角色字串一律沒有任何權限（大小寫／空白／未知角色）",
    junk.every((r) => r !== "operator" && r !== "coach" ? !canAccessAdmin(r) : true) &&
      !canAccessAdmin("ADMIN" as never) && !canEdit("Admin " as never) && !isFullAdmin("root" as never));
  check("isAdminRole：只認 admin，大小寫不同／null／空字串都不是",
    isAdminRole("admin") && !isAdminRole("ADMIN") && !isAdminRole(null) && !isAdminRole("") && !isAdminRole("operator"));
  check("編輯權限是管理員權限的超集合（沒有只能管理員卻不能編輯的人）",
    roles.every((r) => !isFullAdmin(r) || canEdit(r)));
}

// ───────────────────── 2. server action 守門掃描 ─────────────────────
console.log("\n2. server action 守門（直打 action 不可繞過）");
// 公開入口：本來就不需要後台角色。新增項目要有理由，別為了讓測試過就亂加。
const PUBLIC_ACTIONS: Record<string, string> = {
  "auth.ts:loginAction": "登入本身",
  "auth.ts:registerAction": "註冊",
  "auth.ts:forgotPasswordAction": "忘記密碼",
  "auth.ts:logoutAction": "登出",
  "auth.ts:unsubscribeAction": "退訂（憑 token）",
  "board.ts:boardLoginAction": "看板 4 位碼登入（有限流）",
  "board.ts:boardLogoutAction": "看板登出",
  "checkout.ts:createGuestCheckout": "訪客結帳",
  "corporate.ts:submitCorporateInquiryAction": "企業包班詢問表單",
  "live.ts:liveLoginAction": "上課碼登入",
  "live.ts:liveLogoutAction": "上課碼登出",
  "session-checkout.ts:previewSessionPricing": "公開報名頁試算",
  "session-checkout.ts:createSessionCheckout": "公開報名頁結帳",
  "session-signup.ts:submitSignupAction": "公開報名表單",
  "webinar.ts:requestWebinarLinkAction": "講座公開索取表單",
  "webinar.ts:getWebinarDeliveryStatusAction": "講座成功頁輪詢寄送狀態",
};
// 會員層：必須先 getAuthUser() 才能寫入，且身分只能取自 session——不可信任前端傳來的 userId
const MEMBER_ACTIONS: Record<string, string> = {
  "auth.ts:completeProfileAction": "補填手機與個資同意",
  "auth.ts:updatePhoneAction": "會員資料頁改手機",
  "checkout.ts:createCheckout": "一般會員結帳",
  "zone.ts:redeemInviteAction": "兌換專區邀請碼",
};
{
  const dir = path.join(ROOT, "src/actions");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const unguarded: string[] = [];
  const writeBeforeGuard: string[] = [];
  const seenPublic = new Set<string>();
  const seenMember = new Set<string>();
  const memberProblems: string[] = [];
  let total = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // 區域 helper：本檔內未匯出、函式體內含守門呼叫者，呼叫它等同守門
    const helpers: string[] = [];
    let hm: RegExpExecArray | null;
    const allFns: { name: string; idx: number; exported: boolean }[] = [];
    const fnRe = /^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
    while ((hm = fnRe.exec(src))) allFns.push({ name: hm[2], idx: hm.index, exported: !!hm[1] });
    allFns.forEach((fn, i) => {
      if (fn.exported) return;
      const body = src.slice(fn.idx, i + 1 < allFns.length ? allFns[i + 1].idx : src.length);
      if (GUARD_RE.test(body)) helpers.push(fn.name);
    });
    const helperCall = helpers.length
      ? new RegExp(`\\b(${helpers.join("|")})\\s*\\(`)
      : null;
    allFns.forEach((fn, i) => {
      if (!fn.exported) return;
      total++;
      const body = src.slice(fn.idx, i + 1 < allFns.length ? allFns[i + 1].idx : src.length);
      const g = GUARD_RE.exec(body);
      const h = helperCall ? helperCall.exec(body) : null;
      const guardIdx = Math.min(g ? g.index : Infinity, h ? h.index : Infinity);
      const key = `${f}:${fn.name}`;
      if (guardIdx === Infinity) {
        if (key in PUBLIC_ACTIONS) seenPublic.add(key);
        else if (key in MEMBER_ACTIONS) {
          seenMember.add(key);
          const au = /\bgetAuthUser\s*\(/.exec(body);
          const w = WRITE_RE.exec(body);
          if (!au) memberProblems.push(`${key}：沒有 getAuthUser`);
          else if (w && w.index < au.index) memberProblems.push(`${key}：寫入早於身分驗證`);
          if (/(formData|fd)\.get\(\s*["']userId["']\s*\)/.test(body)) memberProblems.push(`${key}：從表單讀 userId（可被竄改）`);
        } else unguarded.push(key);
        return;
      }
      if (key in PUBLIC_ACTIONS) return; // 公開入口內有守門也無妨
      const w = WRITE_RE.exec(body);
      if (w && w.index < guardIdx) writeBeforeGuard.push(`${key}（第一次寫入早於守門）`);
    });
  }
  console.log(`    掃描 ${files.length} 檔、${total} 個匯出 action`);
  check("沒有未列入公開名單、卻也沒守門的 server action", unguarded.length === 0, unguarded.join("\n    "));
  check("沒有『先寫入、後守門』的 server action", writeBeforeGuard.length === 0, writeBeforeGuard.join("\n    "));
  check("會員層 action：先驗登入才寫入、身分取自 session 而非表單", memberProblems.length === 0, memberProblems.join("\n    "));
  const staleMember = Object.keys(MEMBER_ACTIONS).filter((k) => !seenMember.has(k));
  check("會員層名單沒有過期項目", staleMember.length === 0, staleMember.join("\n    "));
  const stale = Object.keys(PUBLIC_ACTIONS).filter((k) => !seenPublic.has(k));
  check("公開名單沒有過期項目（函式被刪除／改名／後來加了守門要移出名單）", stale.length === 0, stale.join("\n    "));
}

// ───────────────────── 3. API route 守門 ─────────────────────
console.log("\n3. API route 守門");
{
  const routes: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name === "route.ts") routes.push(rel);
    }
  };
  walk("src/app/api");
  const adminRoutes = routes.filter((r) => r.includes("/api/admin/"));
  check(`後台匯出端點全部有守門（${adminRoutes.length} 支）`,
    adminRoutes.length > 0 && adminRoutes.every((r) => GUARD_RE.test(read(r))),
    adminRoutes.filter((r) => !GUARD_RE.test(read(r))).join("\n    "));
  const fin = adminRoutes.find((r) => r.includes("finance-sheet"));
  check("收支表匯出限管理員（分潤是內部薪酬）", !!fin && /requireFullAdmin\s*\(/.test(read(fin)));
  const cron = routes.find((r) => r.includes("/cron/"));
  check("cron 端點驗 CRON_SECRET 與 Authorization", !!cron && /CRON_SECRET/.test(read(cron)) && /[Aa]uthorization/.test(read(cron)));
  for (const w of routes.filter((r) => r.includes("/webhooks/"))) {
    check(`${w.replace("src/app/api/", "")} 驗簽且用恆定時間比對`, /timingSafeEqual/.test(read(w)) && /verify/i.test(read(w)));
  }
  for (const p of routes.filter((r) => /payment\/(ecpay|payuni)\/(session-)?notify/.test(r))) {
    check(`${p.replace("src/app/api/", "")} 驗金流簽章`, /verifyCallback/.test(read(p)));
  }
  // 講義下載路由不是『公開端點』：它必須經登入與授權才會回內容（專門斷言如下），所以不放進公開白名單
  const mat = routes.find((r) => r.includes("/api/materials/"));
  if (mat) {
    const src = read(mat);
    const iUser = src.indexOf("getAuthUser()");
    const iLogin = src.search(/redirect\(new URL\("\/login"/);
    const iFind = src.indexOf("courseMaterial.findUnique");
    const iWatch = src.indexOf("canWatchCourse(");
    const iAdmin = src.indexOf("canAccessAdmin(");
    const iSign = src.indexOf("createSignedUrl");
    const iRedirectOut = src.search(/NextResponse\.redirect\((data|material)/);
    check("講義下載路由：先驗登入（未登入轉 /login）→ 查講義 → canWatchCourse 或 canAccessAdmin → 才簽名或轉址",
      iUser > 0 && iLogin > iUser && iFind > iLogin && iWatch > iFind && iAdmin > iFind && iSign > iWatch && iRedirectOut > iWatch,
      JSON.stringify({ iUser, iLogin, iFind, iWatch, iAdmin, iSign, iRedirectOut }));
    check("講義下載路由：沒有權限的分支回 404（不是 200）、查無也回 404，且所有回應都帶 no-store",
      /!allowed\s*&&\s*!canAccessAdmin\([^{]*\)\s*\{\s*return new Response\(null,\s*\{\s*status:\s*404/.test(src) && /if \(!material\) return new Response\(null,\s*\{\s*status:\s*404/.test(src) && !/headers:\s*undefined/.test(src) && (src.match(/noStore/g) ?? []).length >= 5);
    check("講義下載路由：簽名有效期不超過 60 秒，且不使用任何公開網址 API（getPublicUrl）", /createSignedUrl\([^,]+,\s*(\d+)\)/.test(src) && Number(/createSignedUrl\([^,]+,\s*(\d+)\)/.exec(src)?.[1]) <= 60 && !/getPublicUrl/.test(src));
    check("講義下載路由只匯出 GET", /export async function GET/.test(src) && !/export (async )?function (POST|PUT|DELETE|PATCH)/.test(src));
  } else {
    check("講義下載路由存在（/api/materials/[id]）", false, "找不到路由，請更新測試");
  }
  const unlisted = routes.filter(
    (r) => !r.includes("/api/admin/") && !r.includes("/webhooks/") && !r.includes("/cron/") && !r.includes("/payment/") && !r.includes("/api/materials/"),
  );
  // 其餘公開端點應是已知清單；多出新的要人工看過
  const KNOWN_OPEN = ["api/unsubscribe/route.ts", "api/csp-report/route.ts", "api/student-history/template/route.ts"];
  check("其餘無守門的公開 API 只有已審過的三支（退訂憑 token、CSP 回報、空白匯入範本）",
    unlisted.every((r) => KNOWN_OPEN.some((k) => r.endsWith(k))), unlisted.join(", "));
}

// ───────────────────── 4. 僅限管理員的頁面 ─────────────────────
console.log("\n4. 僅限管理員的頁面");
{
  const adminOnly = [
    "src/app/(admin)/admin/staff/page.tsx",
    "src/app/(admin)/admin/finance/page.tsx",
    "src/app/(admin)/admin/finance/[id]/page.tsx",
    "src/app/(admin)/admin/finance/settings/page.tsx",
    "src/app/(admin)/admin/settings/page.tsx",
    "src/app/(admin)/admin/settings/knowledge/page.tsx",
  ];
  for (const p of adminOnly) {
    check(`${p.replace("src/app/(admin)/admin/", "")} 用 pageGuardFullAdmin`,
      /pageGuardFullAdmin\s*\(|requireFullAdmin\s*\(/.test(read(p)));
  }
  for (const p of [
    "src/app/(admin)/admin/sessions/finance/settings/page.tsx",
    "src/app/(admin)/admin/sessions/[id]/finance/page.tsx",
  ]) {
    const s = read(p);
    check(`${p.replace("src/app/(admin)/admin/", "")} 只是轉址、不渲染資料`,
      /redirect\(/.test(s) && !/prisma\./.test(s));
  }
  const staffActions = read("src/actions/admin.ts");
  for (const fn of ["assignStaffRoleAction", "removeStaffRoleAction", "bulkSetPasswordAction", "resetMemberPasswordAction"]) {
    const i = staffActions.indexOf(`export async function ${fn}`);
    const body = staffActions.slice(i, i + 400);
    check(`${fn} 限管理員`, i >= 0 && /requireFullAdmin\s*\(/.test(body));
  }
  // Jason 決定（2026-10-09）：下列三個動作只有管理員能做；操作人員仍可做刪除類與把人加進專區
  const levelOf = (file: string, fn: string): string => {
    const src = read(`src/actions/${file}`);
    const i = src.indexOf(`export async function ${fn}`);
    if (i < 0) return "找不到";
    const body = src.slice(i, i + 600);
    return /requireFullAdmin\(/.test(body) ? "FULL" : /requireEditor\(/.test(body) ? "EDITOR" : /requireStaff\(/.test(body) ? "STAFF" : "無";
  };
  for (const [file, fn, why] of [
    ["sms.ts", "removeSmsOptOutAction", "把號碼移出簡訊退訂名單（合規風險）"],
    ["sessions.ts", "saveBoardCodeAction", "改看板登入碼（合作方存取權限）"],
    ["sms.ts", "updateSmsSettingsAction", "改簡訊單價設定（影響成本顯示）"],
  ] as const) check(`${fn} 限管理員：${why}`, levelOf(file, fn) === "FULL", `目前是 ${levelOf(file, fn)}`);
  for (const [file, fn] of [
    ["admin.ts", "deleteCourse"], ["sessions.ts", "deleteSessionAction"], ["webinar.ts", "deleteWebinarAction"], ["admin.ts", "deleteZoneAction"],
    ["admin.ts", "addZoneMemberAction"], ["admin.ts", "importZoneMembersAction"], ["admin.ts", "createZoneInviteAction"], ["admin.ts", "addMembersToZoneBulkAction"],
  ] as const) check(`${fn} 維持操作人員可做（Jason 決定刪除類與加專區成員不升級）`, levelOf(file, fn) === "EDITOR", `目前是 ${levelOf(file, fn)}`);
  const guardSrc = read("src/actions/admin.ts");
  const pg = guardSrc.indexOf("async function passwordResetGuard");
  const pgBody = guardSrc.slice(pg, pg + 500);
  check("重設密碼擋本人與管理員帳號（passwordResetGuard）",
    /targetId === actorId/.test(pgBody) && /isAdminRole\(profile\.role\)/.test(pgBody));
}

// ───────────────────── 5. layout 與 proxy ─────────────────────
console.log("\n5. layout 與 proxy");
{
  const layout = read("src/app/(admin)/admin/layout.tsx");
  check("(admin) layout：非後台角色被導走", /canAccessAdmin\(role\)\)\s*redirect/.test(layout));
  const proxy = read("src/proxy.ts");
  check("proxy matcher 涵蓋 /admin、/dashboard、/orders、/learn、/my-courses",
    ["/admin/:path*", "/dashboard/:path*", "/orders/:path*", "/learn/:path*", "/my-courses/:path*"].every((m) => proxy.includes(m)));
}

// ───────────────────── 5b. 敏感欄位不外洩給低權限角色 ─────────────────────
console.log("\n5b. 敏感欄位：初始密碼只能給能重設密碼的管理員");
{
  // 會員頁把 MemberPassword（明文初始密碼）整批送進 client component，
  // 再靠 UI 的「顯示」按鈕遮罩。總教練（唯讀）進得了這頁，所以必須在 server 端就不送。
  const page = read("src/app/(admin)/admin/members/page.tsx");
  const m = /initialPassword:\s*([^,\n]+),/g;
  const sends: string[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = m.exec(page))) sends.push(mm[1].trim());
  const gated = sends.length >= 2 && sends.every((expr) => /^canResetPasswordNow\s*\?[\s\S]*:\s*null$/.test(expr));
  check("members/page.tsx：每一處送給 client 的 initialPassword 都是『canResetPasswordNow ? 值 : null』（非管理員一律 null）", gated,
    `目前表達式：${sends.join(" ｜ ")}`);
  const iDef = page.indexOf("const canResetPasswordNow");
  const reads = [...page.matchAll(/memberPassword\.(findMany|findUnique|findFirst)/g)];
  check("members/page.tsx：canResetPasswordNow 在第一次讀取 MemberPassword 之前就已計算", iDef > 0 && reads.length > 0 && reads.every((r) => r.index! > iDef));
  check("members/page.tsx：讀取 MemberPassword 本身也受條件限制（非管理員不查表，連 RSC 序列化都不會有明文）",
    reads.length === 1 && /canResetPasswordNow\s*\?\s*prisma\.memberPassword\.findMany\(\)\s*:\s*Promise\.resolve\(\[\]\)/.test(page));
  // 全站只有這一頁會讀 MemberPassword；新增任何其他讀取點都要重新審視角色限制
  const readers: string[] = [];
  const walkSrc = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walkSrc(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && /memberPassword\.(findMany|findUnique|findFirst|findFirstOrThrow|findUniqueOrThrow)/.test(read(rel))) readers.push(rel);
    }
  };
  walkSrc("src");
  check("全站只有會員管理頁讀取 MemberPassword", readers.length === 1 && readers[0].endsWith("members/page.tsx"), readers.join(", "));
}

// ───────────────────── 6. 看板 token ─────────────────────
async function boardTokens() {
  console.log("\n6. 看板 token（簽章／逾時／換碼／竄改）");
  const GOOD_SECRET = "s".repeat(40);
  process.env.BOARD_SESSION_SECRET = GOOD_SECRET;
  const { signBoardToken, verifyBoardToken, boardCodeEquals } = await import("../src/lib/board-auth");
  const quiet = console.error;
  const exp = Date.now() + 60_000;
  const tok = signBoardToken("1234", exp)!;
  check("簽發的 token 以正確的碼驗得過", !!tok && verifyBoardToken(tok, "1234") instanceof Date);
  check("換一組登入碼就失效（改碼＝踢掉所有人）", verifyBoardToken(tok, "1235") === null);
  const [v, e, n, m] = tok.split(".");
  check("竄改到期時間→失效", verifyBoardToken([v, String(exp + 3_600_000), n, m].join("."), "1234") === null);
  check("竄改 nonce→失效", verifyBoardToken([v, e, "0".repeat(16), m].join("."), "1234") === null);
  check("簽章最後一位翻轉→失效", verifyBoardToken([v, e, n, m.slice(0, -1) + (m.endsWith("0") ? "1" : "0")].join("."), "1234") === null);
  check("版本號不符→失效", verifyBoardToken(["v0", e, n, m].join("."), "1234") === null);
  const expired = signBoardToken("1234", Date.now() - 1000)!;
  check("已逾時的 token 即使簽章正確也失效", verifyBoardToken(expired, "1234") === null);
  for (const [label, raw] of [
    ["空字串", ""], ["只有三段", `${v}.${e}.${n}`], ["五段", `${tok}.x`],
    ["到期時間非數字", [v, "abc", n, m].join(".")], ["到期時間帶負號", [v, "-1", n, m].join(".")],
    ["到期時間超長", [v, "9".repeat(20), n, m].join(".")], ["簽章長度不足", [v, e, n, "ab"].join(".")],
    ["簽章含非十六進位", [v, e, n, "z".repeat(64)].join(".")],
  ] as const) {
    check(`畸形 token 不會 throw、一律拒絕：${label}`, (() => { try { return verifyBoardToken(raw, "1234") === null; } catch { return false; } })());
  }
  check("換 secret 後舊 token 全部失效", (() => {
    process.env.BOARD_SESSION_SECRET = "t".repeat(40);
    const ok = verifyBoardToken(tok, "1234") === null;
    process.env.BOARD_SESSION_SECRET = GOOD_SECRET;
    return ok;
  })());
  console.error = () => undefined; // secret 錯誤時程式會 console.error，測試時靜音
  for (const [label, sec] of [["未設定", undefined], ["空字串", ""], ["31 字元", "x".repeat(31)], ["只有空白", " ".repeat(40)]] as const) {
    if (sec === undefined) delete process.env.BOARD_SESSION_SECRET;
    else process.env.BOARD_SESSION_SECRET = sec;
    check(`secret ${label}：不簽發、不驗證（安全失敗，沒有預設值可猜）`,
      signBoardToken("1234", exp) === null && verifyBoardToken(tok, "1234") === null);
  }
  console.error = quiet;
  process.env.BOARD_SESSION_SECRET = GOOD_SECRET;
  check("boardCodeEquals：位數不同／空字串／相近碼都不相等", boardCodeEquals("1234", "1234") && !boardCodeEquals("123", "1234") && !boardCodeEquals("", "1234") && !boardCodeEquals("12345", "1234") && !boardCodeEquals("1234 ", "1234"));
}

boardTokens()
  .catch((e) => {
    fail++;
    console.error("✗ 看板 token 測試丟出例外：", e);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
