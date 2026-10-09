/* 訂閱／企業專區：邀請碼兌換、會籍、自動開通、每日剪報可見範圍（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 *   A. validateInviteCode：大小寫與空白、不存在／停用／過期／專區停用、惡意字串
 *   B. redeemInvite：會籍寫入（email 正規化、來源標記）、重複兌換冪等、併發連點
 *   C. 自動開通：只開通『期限內』的本區課程，不碰別區、不碰已過期／從未開放的課程
 *   D. 註冊時補開通：名單先匯入、之後才註冊的人；停用專區不開通；不覆蓋既有 userId
 *   E. 每日剪報：會員頁只看得到本專區、已發布的剪報；管理動作皆有守門與輸入檢查
 *
 * 不碰正式 Supabase Auth：全程固定測試 uuid 與假 email，不呼叫任何需要 session 的函式。
 * 跑法：npx tsx --conditions=react-server scripts/test-zone-invite-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import Module from "node:module";

// course-access 會 import auth/staff → next/navigation，在 react-server 條件下載不起來。
// 本測試不涉及『後台幹部』分支，staff 換成永遠回 null 的替身（不放寬任何判斷）。
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

const P = "tzi-";
const U1 = "00000000-0000-4000-8000-0000000000c1";
const U2 = "00000000-0000-4000-8000-0000000000c2";
const U3 = "00000000-0000-4000-8000-0000000000c3";
const USERS = [U1, U2, U3];
const day = 24 * 3600 * 1000;

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.dailyBriefImage.deleteMany({ where: { brief: { group: { slug: { startsWith: P } } } } });
  await prisma.dailyBrief.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.groupInviteCode.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.courseGroupMember.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.courseGroup.deleteMany({ where: { slug: { startsWith: P } } });
}

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const quiet = console.error;

async function main() {
  const { validateInviteCode, redeemInvite } = await import("../src/lib/zone-invite");
  const { autoEnrollGroupCourses, autoEnrollOnRegister } = await import("../src/lib/zone-enroll");
  await cleanup();

  const zone = await prisma.courseGroup.create({ data: { slug: `${P}zone`, name: "測試專區", kind: "SUBSCRIPTION" } });
  const dead = await prisma.courseGroup.create({ data: { slug: `${P}dead`, name: "停用專區", kind: "BUSINESS", isActive: false } });
  const otherZone = await prisma.courseGroup.create({ data: { slug: `${P}other`, name: "別區", kind: "BUSINESS" } });

  const mk = (id: string, groupId: string, until: Date | null) =>
    prisma.course.create({
      data: { id: `${P}${id}`, slug: `${P}${id}`, title: id, description: "測試用", price: 1000, isPublished: true, groupId, openToGroupUntil: until },
    });
  const cOpen = await mk("open", zone.id, new Date(Date.now() + 7 * day));
  const cExpired = await mk("expired", zone.id, new Date(Date.now() - day));
  const cNever = await mk("never", zone.id, null);
  const cOther = await mk("other", otherZone.id, new Date(Date.now() + 7 * day));
  const cDead = await mk("dead", dead.id, new Date(Date.now() + 7 * day));

  const code = (c: string, groupId: string, extra: Record<string, unknown> = {}) =>
    prisma.groupInviteCode.create({ data: { code: c, groupId, ...extra } });
  await code("TZIGOOD1", zone.id);
  await code("TZIOFF01", zone.id, { isActive: false });
  await code("TZIOLD01", zone.id, { expiresAt: new Date(Date.now() - 1000) });
  await code("TZIFUT01", zone.id, { expiresAt: new Date(Date.now() + day) });
  await code("TZIDEAD1", dead.id);

  console.log("\nA. validateInviteCode");
  const okOf = async (raw: string) => {
    try {
      return await validateInviteCode(raw);
    } catch (e) {
      return { ok: false as const, error: `例外:${(e as Error).message.slice(0, 40)}` };
    }
  };
  check("正確的碼 → ok，帶出專區名稱", (await okOf("TZIGOOD1")).ok === true);
  check("小寫＋前後空白也算同一個碼", (await okOf("  tzigood1 ")).ok === true);
  check("尚未到期的碼 → ok", (await okOf("TZIFUT01")).ok === true);
  for (const [label, raw] of [["空字串", ""], ["純空白", "   "]] as const) {
    const r = await okOf(raw);
    check(`${label} → 請輸入邀請碼`, !r.ok && /請輸入/.test(r.error));
  }
  check("不存在的碼 → 拒絕", !(await okOf("NOPE0000")).ok);
  check("碼本身停用 → 拒絕", !(await okOf("TZIOFF01")).ok);
  check("所屬專區停用 → 拒絕", !(await okOf("TZIDEAD1")).ok);
  check("已過期 → 拒絕", !(await okOf("TZIOLD01")).ok);
  for (const [label, raw] of [
    ["SQL injection 字樣", "' OR '1'='1"], ["引號與分號", "TZIGOOD1'; DROP TABLE \"GroupInviteCode\"; --"],
    ["10000 字元", "A".repeat(10_000)], ["萬用字元", "%"], ["emoji", "🍣🍣🍣🍣"],
  ] as const) {
    const r = await okOf(raw);
    check(`惡意輸入不會通過也不會 throw：${label}`, !r.ok && !/例外/.test(r.error), JSON.stringify(r));
  }
  console.error = () => undefined; // NUL 字元會讓 Postgres 丟錯，Prisma 會 console.error
  {
    const r = await okOf("TZI\u0000GOOD");
    check("含 NUL 字元的輸入不 throw（回拒絕即可）", !r.ok && !/例外/.test(r.error), JSON.stringify(r));
  }
  console.error = quiet;

  console.log("\nB. redeemInvite");
  const inv = (await validateInviteCode("TZIGOOD1")) as { ok: true; invite: Parameters<typeof redeemInvite>[0] };
  await redeemInvite(inv.invite, "  Member1@LOCALHOST.test ", { name: "測試一", userId: U1 });
  const m1 = await prisma.courseGroupMember.findMany({ where: { groupId: zone.id } });
  check("會籍已寫入，email 已轉小寫去空白", m1.length === 1 && m1[0].email === "member1@localhost.test", JSON.stringify(m1.map((m) => m.email)));
  check("來源標 INVITE、addedBy 記下邀請碼、userId 回填", m1[0].source === "INVITE" && m1[0].addedBy === "TZIGOOD1" && m1[0].userId === U1);
  await redeemInvite(inv.invite, "member1@localhost.test", { userId: U1 });
  check("同一人重複兌換 → 仍只有 1 筆會籍（冪等）", (await prisma.courseGroupMember.count({ where: { groupId: zone.id } })) === 1);
  const used = (await prisma.groupInviteCode.findUnique({ where: { code: "TZIGOOD1" } }))!.usedCount;
  check("usedCount 只計『不同的人』兌換次數", used === 1, `usedCount=${used}（同一人兌換 2 次被累計成 ${used}，使用次數會被灌水）`);
  const raced = await Promise.allSettled(
    Array.from({ length: 4 }, () => redeemInvite(inv.invite, "member2@localhost.test", { userId: U2 })),
  );
  const rejected = raced.filter((r) => r.status === "rejected").length;
  check("連點 4 次兌換：全部成功，沒有因唯一鍵衝突丟例外", rejected === 0, `失敗 ${rejected}/4：${raced.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason).slice(0, 60)).join(" | ")}`);
  check("連點後該 email 只有 1 筆會籍", (await prisma.courseGroupMember.count({ where: { groupId: zone.id, email: "member2@localhost.test" } })) === 1);

  console.log("\nC. 自動開通範圍");
  const en = async (u: string) => (await prisma.enrollment.findMany({ where: { userId: u }, select: { courseId: true, source: true } })).sort((a, b) => a.courseId.localeCompare(b.courseId));
  check("兌換後只開通『期限內』的本區課程（open），來源 ZONE",
    JSON.stringify(await en(U1)) === JSON.stringify([{ courseId: cOpen.id, source: "ZONE" }]), JSON.stringify(await en(U1)));
  check("沒有開通已過期、從未開放、別區、停用專區的課程", !(await en(U1)).some((e) => [cExpired.id, cNever.id, cOther.id, cDead.id].includes(e.courseId)));
  const n1 = await autoEnrollGroupCourses(zone.id, [{ userId: U1 }]);
  check("重跑自動開通 → 新增 0 筆，總數不變（skipDuplicates）", n1 === 0 && (await en(U1)).length === 1);
  check("沒有 userId（只有 email 的名單成員）→ 不開通", (await autoEnrollGroupCourses(zone.id, [])) === 0);
  await prisma.enrollment.deleteMany({ where: { userId: U3 } });
  await redeemInvite(inv.invite, "nouser@localhost.test", {});
  check("兌換時沒帶 userId → 只入名單、不寫 Enrollment", (await en(U3)).length === 0);

  console.log("\nD. 註冊時補開通");
  await prisma.courseGroupMember.create({ data: { groupId: zone.id, email: "later@localhost.test", source: "IMPORT" } });
  await prisma.courseGroupMember.create({ data: { groupId: dead.id, email: "later@localhost.test", source: "IMPORT" } });
  await autoEnrollOnRegister("  LATER@localhost.test ", U3);
  const later = await prisma.courseGroupMember.findMany({ where: { email: "later@localhost.test" }, orderBy: { groupId: "asc" } });
  const byGroup = Object.fromEntries(later.map((m) => [m.groupId, m.userId]));
  check("先匯入名單、之後註冊：啟用專區的會籍回填 userId（email 大小寫與空白不影響）", byGroup[zone.id] === U3, JSON.stringify(byGroup));
  check("同一人在『停用專區』的會籍不回填、不開通", byGroup[dead.id] === null && !(await en(U3)).some((e) => e.courseId === cDead.id));
  check("註冊補開通：只開通期限內的課", JSON.stringify((await en(U3)).map((e) => e.courseId)) === JSON.stringify([cOpen.id]), JSON.stringify(await en(U3)));
  const beforeStranger = JSON.stringify(await en(U2));
  await autoEnrollOnRegister("stranger@localhost.test", U2);
  check("不在任何名單的 email 註冊 → 沒有任何副作用（Enrollment 不變）", JSON.stringify(await en(U2)) === beforeStranger);

  console.log("\nE. 每日剪報");
  const mkBrief = (groupId: string, dateKey: string, status: string) =>
    prisma.dailyBrief.create({ data: { groupId, dateKey, title: `${status} ${dateKey}`, status, images: { create: [{ imageUrl: "https://example.test/a.png", sortOrder: 0 }] } } });
  await mkBrief(zone.id, "2026-10-01", "PUBLISHED");
  await mkBrief(zone.id, "2026-10-02", "DRAFT");
  await mkBrief(zone.id, "2026-10-03", "UNPUBLISHED");
  await mkBrief(otherZone.id, "2026-10-01", "PUBLISHED");
  const visible = await prisma.dailyBrief.findMany({ where: { groupId: zone.id, status: "PUBLISHED" }, select: { dateKey: true } });
  check("會員頁的查詢條件：只看到本專區且已發布的 1 篇", visible.length === 1 && visible[0].dateKey === "2026-10-01");
  let dup = "";
  try {
    await mkBrief(zone.id, "2026-10-01", "PUBLISHED");
  } catch (e) {
    dup = String((e as Error).message).includes("Unique") ? "unique" : String(e).slice(0, 40);
  }
  check("同專區同一天不能有兩篇（唯一鍵）", dup === "unique", dup);
  const page = read("src/app/(shop)/zone/[groupSlug]/briefs/page.tsx");
  check("剪報頁：只認啟用中的訂閱專區；非會員且非後台幹部看不到內容",
    /kind:\s*"SUBSCRIPTION",\s*isActive:\s*true/.test(page) && /!member\s*&&\s*!canAccessAdmin\(role\)/.test(page));
  check("剪報頁：查詢帶 groupId 與 status: PUBLISHED", /groupId:\s*zone\.id,\s*status:\s*"PUBLISHED"/.test(page));
  const act = read("src/actions/daily-briefs.ts");
  check("剪報管理 action 全部先過 requireEditor", (act.match(/export async function/g) ?? []).length === (act.match(/await requireEditor\(\)/g) ?? []).length);
  check("剪報圖片網址只收 http(s)（擋 javascript:／data:）", /filter\(\(url\)\s*=>\s*\/\^https\?:\\\/\\\/\/\.test\(url\)\)/.test(act));
  check("更新剪報時檢查發布狀態白名單", /\['DRAFT', 'PUBLISHED', 'UNPUBLISHED'\]\.includes\(status\)/.test(act));

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
