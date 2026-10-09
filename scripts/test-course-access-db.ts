/* 課程觀看權限（course-access.ts）驗證（會寫入資料庫，**只能對本機 localhost 跑**）。
 * 觀看權限是付費內容的唯一閘門：誰能看、誰不能看，邊界一旦錯就是「沒付錢看得到」或「付了錢看不到」。
 *
 *   A. canWatchCourse 矩陣：未登入／已開通／未開通／買 A 課看 B 課／專區成員（訂閱制、限時開放、過期）
 *   B. email 比對：大小寫與前後空白不能造成誤擋或誤放；email 為 null 不放行
 *   C. 退出名單立即失去資格；別區的會籍不能開這區的課
 *   D. 專區停用（isActive=false，產品語意＝前台整區 404）後，成員不應還能看
 *   E. 販售期間判定與公開型錄 where（企業專區課程不進公開型錄）
 *   F. 觀看頁／我的課程／課程詳情頁的靜態契約：先驗登入、章節只取自本課程、權限走 canWatchCourse
 *
 * 不碰正式 Supabase Auth：使用固定測試 uuid 與假 email，不呼叫任何需要 session 的函式
 *（canViewGroupCourse 的『後台幹部』分支需要 getAuthUser，這裡只測不依賴 session 的分支）。
 * 跑法：npx tsx --conditions=react-server scripts/test-course-access-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import Module from "node:module";

// course-access 為了『後台幹部』分支會 import auth/staff，而 staff 拉進 next/navigation（需要完整 React），
// 在 react-server 條件下載不起來。本測試只測不依賴 session 的分支，所以把 staff 換成永遠回 null 的替身——
// 等於「目前登入者不是後台幹部」，不會放寬任何判斷。
type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/auth/staff") return { currentStaffRole: async () => null };
  return origLoad.call(this, request, ...rest);
};

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

const P = "tca-";
const U_OWN = "00000000-0000-4000-8000-0000000000b1";
const U_NONE = "00000000-0000-4000-8000-0000000000b2";
const U_MEM = "00000000-0000-4000-8000-0000000000b3";
const USERS = [U_OWN, U_NONE, U_MEM];
const E_MEM = "member-tca@localhost.test";
const day = 24 * 3600 * 1000;

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.courseGroupMember.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.lesson.deleteMany({ where: { course: { slug: { startsWith: P } } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.courseGroup.deleteMany({ where: { slug: { startsWith: P } } });
}

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

async function main() {
  const {
    canWatchCourse, canViewGroupCourse, isGroupMember, isCoursePublicActive, publicCourseWhere, normalizeEmail,
  } = await import("../src/lib/course-access");
  await cleanup();

  const base = { description: "測試用，跑完會刪", price: 1000, isPublished: true };
  const open = await prisma.course.create({ data: { ...base, id: `${P}open`, slug: `${P}open`, title: "一般課 A" } });
  const other = await prisma.course.create({ data: { ...base, id: `${P}other`, slug: `${P}other`, title: "一般課 B" } });
  const subGroup = await prisma.courseGroup.create({ data: { slug: `${P}sub`, name: "訂閱專區", kind: "SUBSCRIPTION" } });
  const bizGroup = await prisma.courseGroup.create({ data: { slug: `${P}biz`, name: "企業專區", kind: "BUSINESS" } });
  const subCourse = await prisma.course.create({ data: { ...base, id: `${P}sub`, slug: `${P}sub`, title: "訂閱課", groupId: subGroup.id } });
  const bizOpen = await prisma.course.create({
    data: { ...base, id: `${P}biz-open`, slug: `${P}biz-open`, title: "企業課（限時開放中）", groupId: bizGroup.id, openToGroupUntil: new Date(Date.now() + 7 * day) },
  });
  const bizExpired = await prisma.course.create({
    data: { ...base, id: `${P}biz-exp`, slug: `${P}biz-exp`, title: "企業課（開放已過期）", groupId: bizGroup.id, openToGroupUntil: new Date(Date.now() - day) },
  });
  const bizNever = await prisma.course.create({
    data: { ...base, id: `${P}biz-never`, slug: `${P}biz-never`, title: "企業課（從未開放）", groupId: bizGroup.id },
  });

  await prisma.enrollment.create({ data: { userId: U_OWN, courseId: open.id, source: "PURCHASE" } });
  const mem = (groupId: string, email = E_MEM) => prisma.courseGroupMember.create({ data: { groupId, email, source: "MANUAL" } });
  await mem(subGroup.id);
  await mem(bizGroup.id);

  const own = { id: U_OWN, email: "own-tca@localhost.test" };
  const none = { id: U_NONE, email: "none-tca@localhost.test" };
  const member = { id: U_MEM, email: E_MEM };

  console.log("\nA. canWatchCourse 矩陣");
  check("未登入 → 不可看", (await canWatchCourse(open, null)) === false);
  check("已開通本課 → 可看", (await canWatchCourse(open, own)) === true);
  check("未開通 → 不可看", (await canWatchCourse(open, none)) === false);
  check("開通 A 課不代表能看 B 課", (await canWatchCourse(other, own)) === false);
  check("訂閱專區成員（無 Enrollment）→ 可看專區課", (await canWatchCourse(subCourse, member)) === true);
  check("非專區成員 → 不可看訂閱課", (await canWatchCourse(subCourse, none)) === false);
  check("企業專區『限時開放中』的成員 → 可看", (await canWatchCourse(bizOpen, member)) === true);
  check("企業專區『限時開放中』的非成員 → 不可看", (await canWatchCourse(bizOpen, none)) === false);
  check("企業專區『開放已過期』的成員 → 不可看（回到手動開通）", (await canWatchCourse(bizExpired, member)) === false);
  check("企業專區『從未開放』的成員 → 不可看", (await canWatchCourse(bizNever, member)) === false);

  console.log("\nB. email 比對");
  check("normalizeEmail 去空白＋轉小寫", normalizeEmail("  Foo@X.COM ") === "foo@x.com");
  check("成員 email 大小寫與前後空白不同 → 仍可看（不誤擋）", (await canWatchCourse(subCourse, { id: U_MEM, email: `  ${E_MEM.toUpperCase()} ` })) === true);
  check("user.email 為 null 的專區課 → 不放行", (await canWatchCourse(subCourse, { id: U_NONE, email: null })) === false);
  check("isGroupMember 對空字串／undefined／null 都回 false", !(await isGroupMember(subGroup.id, "")) && !(await isGroupMember(subGroup.id, undefined)) && !(await isGroupMember(subGroup.id, null)));
  check("近似 email（多一字、子字串、LIKE 萬用字元）不會誤放行",
    !(await isGroupMember(subGroup.id, `x${E_MEM}`)) && !(await isGroupMember(subGroup.id, E_MEM.slice(1))) && !(await isGroupMember(subGroup.id, "%@localhost.test")) && !(await isGroupMember(subGroup.id, "member-tca@localhost.test' OR '1'='1")));

  console.log("\nC. 退出名單與跨區");
  check("canViewGroupCourse：一般課（groupId=null）恆為 true", (await canViewGroupCourse(open, null)) === true);
  check("canViewGroupCourse：專區成員 → true", (await canViewGroupCourse(subCourse, { email: E_MEM })) === true);
  await prisma.courseGroupMember.deleteMany({ where: { groupId: subGroup.id } });
  check("移出訂閱專區名單 → 立即不可看", (await canWatchCourse(subCourse, member)) === false);
  check("別區（企業區）的會籍不能開訂閱區的課", (await canWatchCourse(subCourse, member)) === false);
  await prisma.courseGroupMember.deleteMany({ where: { groupId: bizGroup.id } });
  check("移出企業專區名單 → 限時開放中的課也立即不可看", (await canWatchCourse(bizOpen, member)) === false);
  await mem(subGroup.id);
  await mem(bizGroup.id);

  console.log("\nD. 專區停用後");
  await prisma.courseGroup.update({ where: { id: subGroup.id }, data: { isActive: false } });
  check("訂閱專區停用（schema 註解：停用＝前台整區 404）→ 成員不應還能看專區課",
    (await canWatchCourse(subCourse, member)) === false,
    "停用後成員仍可觀看；/zone 頁會 404，但 /learn/<slug> 直接輸入網址仍通");
  await prisma.courseGroup.update({ where: { id: subGroup.id }, data: { isActive: true } });

  console.log("\nE. 販售期間與公開型錄");
  const now = Date.now();
  check("上架中、無下架時間 → 販售中", isCoursePublicActive({ isPublished: true, unpublishAt: null }));
  check("未上架 → 不販售", !isCoursePublicActive({ isPublished: false, unpublishAt: null }));
  check("下架時間已過 → 不販售", !isCoursePublicActive({ isPublished: true, unpublishAt: new Date(now - 1000) }));
  check("下架時間未到 → 販售中", isCoursePublicActive({ isPublished: true, unpublishAt: new Date(now + day) }));
  check("未上架即使下架時間在未來也不販售", !isCoursePublicActive({ isPublished: false, unpublishAt: new Date(now + day) }));
  const listed = await prisma.course.findMany({ where: { ...publicCourseWhere(), slug: { startsWith: P } }, select: { slug: true } });
  const slugs = listed.map((c) => c.slug).sort();
  check("公開型錄只含一般課，企業／訂閱專區課程全部不在內",
    JSON.stringify(slugs) === JSON.stringify([`${P}open`, `${P}other`].sort()), JSON.stringify(slugs));
  await prisma.course.update({ where: { id: other.id }, data: { unpublishAt: new Date(now - 1000) } });
  const listed2 = await prisma.course.findMany({ where: { ...publicCourseWhere(), slug: `${P}other` } });
  check("下架時間已過的課從型錄消失", listed2.length === 0);

  console.log("\nF. 頁面靜態契約");
  const learn = read("src/app/(member)/learn/[courseSlug]/page.tsx");
  const iUser = learn.indexOf("getAuthUser()");
  const iRedirect = learn.indexOf('redirect("/login")');
  const iFind = learn.indexOf("prisma.course.findUnique");
  const iGate = learn.indexOf("canWatchCourse(");
  check("觀看頁：先驗登入（未登入導 /login）才查課程", iUser > 0 && iRedirect > iUser && iFind > iRedirect);
  check("觀看頁：查到課程後、輸出內容前先過 canWatchCourse", iGate > iFind && iGate < learn.indexOf("course.lessons.length === 0"));
  check("觀看頁：未通過閘門只有管理員例外（isAdminRole），其他一律導回課程頁", /!allowed\s*&&\s*!isAdminRole\(/.test(learn) && /redirect\(`\/courses\/\$\{courseSlug\}`\)/.test(learn));
  check("觀看頁：?lesson= 只從本課程的 lessons 中挑（不能用別課的章節 id 看別課影片）",
    /course\.lessons\.find\(\(l\)\s*=>\s*l\.id === lesson\)/.test(learn) && !/prisma\.lesson/.test(learn));
  const my = read("src/app/(member)/my-courses/page.tsx");
  check("我的課程：先驗登入，且只查 userId = 目前登入者的 Enrollment", my.indexOf('redirect("/login")') > 0 && /enrollment\.findMany\(\{\s*where:\s*\{\s*userId:\s*user\.id\s*\}/.test(my));
  const shop = read("src/app/(shop)/courses/[slug]/page.tsx");
  check("課程詳情頁：專區課程先過 canViewGroupCourse，未通過導去專區擋牆", /canViewGroupCourse\(course, user\)/.test(shop) && /redirect\(`\/zone\//.test(shop));
  check("課程詳情頁（公開）不輸出章節的 youtubeId／簡報網址", !/youtubeId|slideUrl/.test(shop));

  await cleanup();
  console.log("\n  （測試資料已清理）");
}

main()
  .catch((e) => {
    fail++;
    console.error("✗ 例外：", e);
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
