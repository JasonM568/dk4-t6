/* 物件層級授權（IDOR）靜態驗證——純讀原始碼，不連資料庫、不起服務。
 *
 * IDOR＝拿到別人（或別的父層）的 id／單號就能讀寫對方的資料。這支檢查『有帶 id 進來的入口』，
 * 在它查資料或寫資料時，有沒有把範圍限定在呼叫者自己能碰的東西上：
 *
 *   A  會員端：訂單頁、上課頁、我的課程、補填資料、改手機、結帳——資料範圍必須綁登入者自己
 *   B  公開的『持單號就能看』頁面（付款後落地頁）：只露出必要欄位、信箱要遮罩
 *   C  公開的動態頁面（課程、文章、自訂頁、專區、剪報、講座、報名頁）：未上架／停用時不可見
 *   D  身分只能取自 session：非後台守門的 action 不可從表單讀 userId 當身分
 *   E  後台『子資源＋父層』寫入：where 條件要同時綁父層 id（防止拿 A 課的 id 刪 B 課的章節）
 *
 * 後台角色高低（operator 能不能碰管理員專屬設定）屬權限政策，列在報告裡，不在這裡斷言。
 * 跑法：npx tsx scripts/test-idor-static.ts（任何環境皆可，不連資料庫） */
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`);
  }
}
const ROOT = process.env.QA_ROOT ?? process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

/** 切出一個匯出函式的本體（到下一個匯出函式為止） */
function fnBody(src: string, name: string): string {
  const re = /^export (?:default )?(?:async )?function (\w+)/gm;
  const hits: { n: string; i: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) hits.push({ n: m[1], i: m.index });
  const k = hits.findIndex((h) => h.n === name);
  if (k < 0) return "";
  return src.slice(hits[k].i, k + 1 < hits.length ? hits[k + 1].i : src.length);
}

// ───────────────────── A. 會員端 ─────────────────────
console.log("\nA. 會員端資料範圍");
{
  const orderPage = read("src/app/(member)/orders/[orderNo]/page.tsx");
  const iUser = orderPage.indexOf("getAuthUser()");
  const iFind = orderPage.indexOf("prisma.order.findUnique");
  check("訂單詳情頁：先驗登入再查單", iUser > 0 && iFind > iUser && /redirect\("\/login"\)/.test(orderPage));
  check("訂單詳情頁：不是自己的單一律 notFound（不洩漏單號是否存在）", /order\.userId\s*!==\s*user\.id\)\s*notFound\(\)/.test(orderPage) && /!order\s*\|\|/.test(orderPage));

  const ordersList = exists("src/app/(member)/orders/page.tsx") ? read("src/app/(member)/orders/page.tsx") : "";
  check("訂單列表：只查 userId = 登入者", /order\.findMany\(\{[\s\S]{0,120}userId:\s*user\.id/.test(ordersList));

  const profile = read("src/actions/auth.ts");
  check("補填資料／改手機：寫入範圍綁 user.id（memberProfile where userId: user.id）",
    /memberProfile\.upsert\(\{\s*where:\s*\{\s*userId:\s*user\.id\s*\}/.test(fnBody(profile, "completeProfileAction")) &&
      /memberProfile\s*\.updateMany\(\{\s*where:\s*\{\s*userId:\s*user\.id\s*\}/.test(fnBody(profile, "updatePhoneAction")));

  const checkout = read("src/actions/checkout.ts");
  const member = fnBody(checkout, "createCheckout");
  check("會員結帳：訂單 userId 取自 session，不吃表單／參數", /userId,\s*\n?\s*buyerEmail|userId,\s*$/m.test(member) && /const userId = user\.id/.test(member));
  check("會員結帳：只賣公開上架且非專區的課（isCoursePublicActive 且 groupId 為空）", /isCoursePublicActive\(course\)/.test(member) && /course\.groupId/.test(member));
  const guest = fnBody(checkout, "createGuestCheckout");
  check("訪客結帳：同樣只賣公開上架且非專區的課", /isCoursePublicActive\(course\)/.test(guest) && /course\.groupId/.test(guest));
  check("訪客結帳：價格取自課程資料庫，不吃前端傳入的金額", /subtotal = course\.price/.test(guest) && !/buyer\.(price|amount|total)/.test(guest));
}

// ───────────────────── B. 持單號可看的公開頁 ─────────────────────
console.log("\nB. 付款後落地頁（持單號即可查看）");
{
  const thanks = read("src/app/event/thanks/page.tsx");
  const select = /select:\s*\{([^}]*)\}/.exec(thanks)?.[1] ?? "";
  check("只查必要欄位：不含手機、參加者名單、金額、金流原始回傳", !/phone|attendees|rawCallback|total|buyerPhone|tradeNo/i.test(select), select.trim());
  check("訂購人信箱要遮罩後再顯示（單號出現在網址列，會被瀏覽紀錄、Referer、截圖流出，整串信箱等於洩漏個資）",
    !/buyerEmail/.test(thanks) || /mask|\*{2,}|replace\(/i.test(thanks), "頁面直接顯示完整的訂購人信箱");
  const order = read("src/lib/session-signup-page.ts");
  check("場次報名單號是隨機 10 位英數（不可枚舉）", /alphabet/.test(order) && /i < 10/.test(order));
}

// ───────────────────── C. 公開動態頁面 ─────────────────────
console.log("\nC. 公開動態頁面的可見範圍");
{
  const pages: [string, RegExp, string][] = [
    ["src/app/(shop)/courses/[slug]/page.tsx", /isCoursePublicActive\(course\)\)\s*notFound\(\)/, "課程：未上架或已下架 → 404"],
    ["src/app/(shop)/knowledge/[slug]/page.tsx", /article\.status\s*!==\s*"PUBLISHED"/, "知識文章：非 PUBLISHED → 404"],
    ["src/app/p/[slug]/page.tsx", /!page\.isPublished\)\s*notFound\(\)/, "自訂頁：未發布 → 404"],
    ["src/app/(shop)/zone/[groupSlug]/page.tsx", /!zone\.isActive\)\s*notFound\(\)/, "專區：停用 → 404"],
    ["src/app/(shop)/zone/[groupSlug]/briefs/page.tsx", /kind:\s*"SUBSCRIPTION",\s*isActive:\s*true/, "每日剪報：只認啟用中的訂閱專區"],
  ];
  for (const [p, re, label] of pages) check(`${label}`, re.test(read(p)), p);
  check("剪報頁：非會員且非後台幹部不輸出任何剪報", /!member\s*&&\s*!canAccessAdmin\(role\)/.test(read("src/app/(shop)/zone/[groupSlug]/briefs/page.tsx")));
  const kn = read("src/app/(shop)/knowledge/[slug]/page.tsx");
  check("訂閱者限定文章：會籍要求專區啟用中（isActive: true）", /visibility === "SUBSCRIBER"[\s\S]{0,400}isActive:\s*true/.test(kn));
  const ev = read("src/app/event/[slug]/page.tsx");
  check("報名頁：用 signupState 判斷開放狀態，關閉時不給表單", /signupState|resolveSignupMode/.test(ev));
  const wb = read("src/app/webinar/[slug]/page.tsx");
  check("講座頁：停用或結束時不渲染索取表單", /webinar\.isActive && !hasEndedInTaipei/.test(wb));
  const shop = read("src/lib/course-access.ts");
  check("公開型錄 where 排除專區課程（groupId: null）", /groupId:\s*null/.test(shop));
}

// ───────────────────── D. 身分只取自 session ─────────────────────
console.log("\nD. 身分來源");
{
  const dir = path.join(ROOT, "src/actions");
  const offenders: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const re = /^export async function (\w+)/gm;
    const hits: { n: string; i: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) hits.push({ n: m[1], i: m.index });
    hits.forEach((h, k) => {
      const body = src.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : src.length);
      const staffGuarded = /\b(requireStaff|requireEditor|requireFullAdmin)\s*\(/.test(body) || /\bactorEmail\s*\(/.test(body);
      if (staffGuarded) return;
      if (/formData\.get\(\s*["'](userId|user_id|ownerId|memberId)["']\s*\)/.test(body)) offenders.push(`${f}:${h.n}`);
    });
  }
  check("沒有任何非後台守門的 action 從表單讀 userId／ownerId 當身分", offenders.length === 0, offenders.join(", "));
  const gw = read("src/actions/webinar.ts");
  check("講座寄送狀態輪詢：必須同時知道 slug 與 email，且只回 15 分鐘內的結果（PM 已評估不修）", /STATUS_QUERY_WINDOW_MS/.test(fnBody(gw, "getWebinarDeliveryStatusAction")) || /STATUS_QUERY_WINDOW_MS/.test(gw));
}

// ───────────────────── E. 後台子資源＋父層寫入 ─────────────────────
console.log("\nE. 後台寫入的父層範圍");

/** 取出『寫入那一句』的 where 內容（含 update／updateMany／delete／deleteMany／upsert），逐句判斷。
 *  不再看整個函式有沒有出現父層參數——前面別的查詢（例如重複檢查）帶了父層 id 不代表寫入有被限定。 */
function writeWheres(logic: string): string[] {
  const out: string[] = [];
  const re = /\b(?:prisma|tx)\.\w+\.(?:update|updateMany|delete|deleteMany|upsert)\(\s*\{\s*where:\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logic))) out.push(m[1]);
  return out;
}
/** 守門讀取：用『子 id＋父層 id』正向比對查出該筆，查不到就提早結束。
 *  重複檢查（NOT: { id: 子 id }）不算守門。 */
function hasGuardRead(logic: string, child: string, parent: string): boolean {
  const re = /\b(?:prisma|tx)\.\w+\.(?:findFirst|findUnique|count)\(\{\s*where:\s*\{([^}]*)\}[^]*?\)\s*;?\s*\n\s*if\s*\(\s*!\w+\s*\)\s*(?:return|\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logic))) {
    const w = m[1];
    const positiveChild = new RegExp(`(?<!NOT:\\s*\\{\\s*)\\bid:\\s*${child}\\b|\\b${child}\\b(?!\\s*\\})`).test(w.replace(/NOT:\s*\{[^}]*\}/g, ""));
    if (positiveChild && new RegExp(`\\b${parent}\\b`).test(w.replace(/NOT:\s*\{[^}]*\}/g, ""))) return true;
  }
  return false;
}
function isParentScoped(body: string, child: string, parent: string): boolean {
  // 去掉函式簽名（簽名裡一定同時有子 id 與父層 id）與 revalidate 之後的部分
  const logic = body.slice(body.indexOf("{", body.indexOf(")")) + 1).split("revalidate")[0];
  const wheres = writeWheres(logic);
  if (wheres.length === 0) return false;
  if (wheres.every((w) => new RegExp(`\\b${parent}\\b`).test(w))) return true; // 每一句寫入自己就綁了父層
  return hasGuardRead(logic, child, parent); // 或：先用子＋父層讀取守門，查不到就結束
}

// 掃描器自測：確保它不會被『別的查詢帶了父層 id』騙過（工程1 回報的情況）
{
  const dupOnly = `export async function f(memberId: string, groupId: string, fd: FormData) {
  await requireEditor();
  const dup = await prisma.mailGroupMember.findFirst({
    where: { groupId, email, NOT: { id: memberId } },
    select: { id: true },
  });
  if (dup) return { error: "x" };
  await prisma.mailGroupMember.update({ where: { id: memberId }, data: { email } });
}`;
  check("自測：只有『重複檢查』帶父層 id、寫入本身沒綁父層 → 判為未綁（不被前一行的查詢騙過）", !isParentScoped(dupOnly, "memberId", "groupId"));
  const writeScoped = `export async function f(memberId: string, groupId: string) {
  await requireEditor();
  const dup = await prisma.x.findFirst({ where: { NOT: { id: memberId } } });
  const updated = await prisma.mailGroupMember.updateMany({
    where: { id: memberId, groupId },
    data: { name: "n" },
  });
}`;
  check("自測：寫入的 where 自己就含父層 id → 判為已綁", isParentScoped(writeScoped, "memberId", "groupId"));
  const guarded = `export async function f(studentId: string, historyId: string) {
  await actorEmail();
  const existing = await prisma.studentCourseHistory.findFirst({ where: { id: historyId, studentId } });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.studentCourseHistory.delete({ where: { id: historyId } });
  });
}`;
  check("自測：先用『子＋父層』正向讀取守門、查不到就結束，之後只用子 id 寫入 → 判為已綁", isParentScoped(guarded, "historyId", "studentId"));
  const onlyRevalidate = `export async function f(lessonId: string, courseId: string) {
  await requireEditor();
  await prisma.lesson.delete({ where: { id: lessonId } });
  revalidatePath(\`/admin/courses/\${courseId}\`);
}`;
  check("自測：父層 id 只出現在 revalidatePath → 判為未綁", !isParentScoped(onlyRevalidate, "lessonId", "courseId"));
  const readNoGuardReturn = `export async function f(studentId: string, historyId: string) {
  const existing = await prisma.studentCourseHistory.findFirst({ where: { id: historyId, studentId } });
  await prisma.studentCourseHistory.delete({ where: { id: historyId } });
}`;
  check("自測：有讀取但讀不到時沒有提早結束 → 不算守門，判為未綁", !isParentScoped(readNoGuardReturn, "historyId", "studentId"));
}

{
  // [檔案, 函式, 子 id 參數, 父層參數]
  const table: [string, string, string, string][] = [
    ["admin.ts", "updateLesson", "lessonId", "courseId"],
    ["admin.ts", "deleteLesson", "lessonId", "courseId"],
    ["admin.ts", "deleteMaterial", "materialId", "courseId"],
    ["admin.ts", "removeGroupMember", "memberId", "groupId"],
    ["admin.ts", "updateGroupMemberAction", "memberId", "groupId"],
    ["admin.ts", "removeZoneMember", "memberId", "zoneId"],
    ["admin.ts", "toggleZoneInvite", "inviteId", "zoneId"],
    ["student-maintenance.ts", "updateHistoryAction", "historyId", "studentId"],
    ["student-maintenance.ts", "deleteHistoryAction", "historyId", "studentId"],
    ["student-maintenance.ts", "deleteEngagementAction", "engagementId", "studentId"],
  ];
  const unscoped: string[] = [];
  for (const [file, fn, child, parent] of table) {
    const body = fnBody(read(`src/actions/${file}`), fn);
    if (!body) { unscoped.push(`${fn}（找不到函式，請更新測試表）`); continue; }
    if (!isParentScoped(body, child, parent)) unscoped.push(`${fn}(${child}, ${parent})`);
  }
  check("子資源寫入的 where 同時綁父層 id（拿 A 的子資源 id 搭配 B 的父層 id 不能動到 A 的資料）", unscoped.length === 0,
    `${unscoped.length}/${table.length} 個 action 只用子資源 id 寫入，父層參數只拿來 revalidatePath：${unscoped.join("、")}`);
}

console.log(`\n結果：${pass} 通過、${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
