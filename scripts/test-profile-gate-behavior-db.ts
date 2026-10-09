/* R17（方案 B）行為驗證：資料不全的舊生看影片不再被卡，真正需要手機的地方仍然必填。
 * 會寫入資料庫，**只能對本機 localhost 跑**。
 *
 *  A  登入：資料不全的舊生登入後直達目的地（/dashboard），不再被導去 /complete-profile；密碼錯誤仍回錯誤
 *  B  會員區 layout：不再擋人
 *  C  我的課程／上課頁／會員中心：資料不全的舊生可以直達（不被導走），並且出現補填提醒；
 *     補齊後提醒消失；沒開通課程的人仍然被導回課程頁（觀看權限這道真正的閘門沒被拆掉）
 *  D  提醒本身：連結只指向站內補填頁、next 被安全編碼；7 天關閉記憶；localStorage 失效時仍可顯示
 *  E  結帳：沒有姓名或手機的會員仍然被導去補填頁（會員結帳的前置閘門保留）
 *  F  補填頁：仍然可用；補完導回原頁（含查詢字串）；惡意 next 退回預設
 *
 * 不碰外部服務：Supabase Auth／Admin 以 Module._load 換成本機替身（admin 的任何呼叫都會丟錯，確保沒漏網）。
 * 跑法：npx tsx --conditions=react-server scripts/test-profile-gate-behavior-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import { readFileSync } from "node:fs";
import Module from "node:module";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_SECRET_KEY = "";

// ── 本機替身 ──
type FakeUser = { id: string; email: string; displayName?: string | null } | null;
let currentUser: FakeUser = null;
let loginResult: { userId: string; fail?: boolean } = { userId: "" };
type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request === "next/navigation") return { redirect(u: string) { throw new Error(`NEXT_REDIRECT:${u}`); }, notFound() { throw new Error("NEXT_NOT_FOUND"); } };
  if (request === "next/link") return { __esModule: true, default: function Link() { return null; } };
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/headers") return { headers: async () => new Headers({ "x-real-ip": "198.51.100.200" }), cookies: async () => ({ get: () => undefined, set() {}, delete() {} }) };
  if (request === "@/lib/supabase/server") {
    return {
      getAuthUser: async () => currentUser,
      createClient: async () => ({
        auth: {
          signInWithPassword: async () => (loginResult.fail ? { data: {}, error: { code: "invalid_credentials", status: 400 } } : { data: { user: { id: loginResult.userId } }, error: null }),
          signOut: async () => ({}),
        },
      }),
    };
  }
  if (request === "@/lib/supabase/admin") return new Proxy({ getProfileRole: async () => null, getProfile: async () => null }, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`漏網：呼叫了 supabase/admin.${String(k)}`); }) });
  if (request === "@/lib/auth/staff") return { currentStaffRole: async () => null, getStaffRole: async () => null, requireEditor: async () => "admin", requireStaff: async () => "admin", requireFullAdmin: async () => "admin" };
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

const P = `tpg${process.pid}-`;
const U = (n: number) => `00000000-0000-4000-8000-${String(6000 + n).padStart(12, "0")}`;
const USERS = [U(1), U(2), U(3), U(4), U(5)];
const user = (n: number): FakeUser => ({ id: U(n), email: `u${n}${P}@localhost.test`, displayName: `學員${n}` });
const quiet = console.error;

/** 執行會 redirect 的函式：回傳 { redirect: url } 或 { value } */
async function run<T>(fn: () => Promise<T>): Promise<{ redirect?: string; value?: T; error?: string }> {
  try {
    return { value: await fn() };
  } catch (e) {
    const m = String((e as Error).message ?? e);
    if (m.startsWith("NEXT_REDIRECT:")) return { redirect: m.slice("NEXT_REDIRECT:".length) };
    return { error: m.slice(0, 120) };
  }
}
/** 在 React 元素樹裡找出符合條件的節點 */
function find(node: unknown, pred: (el: { type: unknown; props: Record<string, unknown> }) => boolean): { type: unknown; props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = find(n, pred);
      if (r) return r;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type !== undefined && el.props && pred(el as { type: unknown; props: Record<string, unknown> })) return el as { type: unknown; props: Record<string, unknown> };
  return el.props ? find(el.props.children, pred) : null;
}

async function cleanup() {
  await prisma.payment.deleteMany({ where: { order: { userId: { in: USERS } } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId: { in: USERS } } } });
  await prisma.order.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.enrollment.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.memberProfile.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.lesson.deleteMany({ where: { course: { slug: { startsWith: P } } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.studentRecord.deleteMany({ where: { email: { endsWith: `${P}@localhost.test` } } });
}

async function main() {
  const auth = await import("../src/actions/auth");
  const { ProfileReminder } = await import("../src/components/member/profile-reminder");
  await cleanup();

  const base = { description: "測試", price: 1000, isPublished: true };
  const course = await prisma.course.create({ data: { ...base, id: `${P}c`, slug: `${P}c`, title: "資料不全閘門測試課" } });
  await prisma.lesson.create({ data: { courseId: course.id, title: "第一章", youtubeId: "dQw4w9WgXcQ", order: 1 } });
  // U1：舊生，完全沒有 MemberProfile 列；U2：只有手機沒有同意；U3：已補齊；U4：沒買課；U5：有同意但缺姓名
  for (const n of [1, 2, 3, 5]) await prisma.enrollment.create({ data: { userId: U(n), courseId: course.id, source: "PURCHASE" } });
  await prisma.memberProfile.create({ data: { userId: U(2), phone: "0900000401", name: "只有手機" } });
  await prisma.memberProfile.create({ data: { userId: U(3), phone: "0900000402", name: "已補齊", privacyConsentAt: new Date(), privacyConsentVersion: "test" } });
  await prisma.memberProfile.create({ data: { userId: U(5), phone: "0900000403", name: null, privacyConsentAt: new Date(), privacyConsentVersion: "test" } });

  // ═══ A ═══
  console.log("\nA. 登入");
  {
    currentUser = null;
    for (const n of [1, 2]) {
      loginResult = { userId: U(n) };
      const fd = new FormData();
      fd.set("email", `u${n}${P}@localhost.test`);
      fd.set("password", "abcdef");
      const r = await run(() => auth.loginAction({} as never, fd));
      check(`U${n}（${n === 1 ? "完全沒有補填資料" : "有手機沒同意"}）登入 → 直達 /dashboard，不被導去補填頁`, r.redirect === "/dashboard", JSON.stringify(r));
    }
    loginResult = { userId: U(1), fail: true };
    const bad = new FormData();
    bad.set("email", `u1${P}@localhost.test`);
    bad.set("password", "wrongpw");
    const rb = await run(() => auth.loginAction({} as never, bad));
    check("密碼錯誤仍然回錯誤、不導向", !rb.redirect && !!rb.value && "error" in (rb.value as object), JSON.stringify(rb));
  }

  // ═══ B ═══
  console.log("\nB. 會員區 layout");
  {
    const Layout = (await import("../src/app/(member)/layout")).default;
    for (const n of [1, 2, 3]) {
      currentUser = user(n);
      const r = await run(async () => (Layout as unknown as (p: { children: string }) => unknown)({ children: "內容" }));
      check(`U${n} 進會員區 layout → 不導走、直接顯示內容`, !r.redirect && !r.error, JSON.stringify(r));
    }
  }

  // ═══ C ═══
  console.log("\nC. 我的課程／上課頁／會員中心");
  {
    const MyCourses = (await import("../src/app/(member)/my-courses/page")).default as () => Promise<unknown>;
    const Learn = (await import("../src/app/(member)/learn/[courseSlug]/page")).default as (p: { params: Promise<{ courseSlug: string }>; searchParams: Promise<{ lesson?: string }> }) => Promise<unknown>;
    const Dashboard = (await import("../src/app/(member)/dashboard/page")).default as () => Promise<unknown>;
    const isReminder = (el: { type: unknown }) => el.type === ProfileReminder;
    const reminderOf = async (tree: unknown) => {
      const el = find(tree, isReminder);
      if (!el) return { present: false as const };
      const out = await (ProfileReminder as unknown as (p: Record<string, unknown>) => Promise<unknown>)(el.props);
      return { present: true as const, rendered: out !== null, href: (find(out, () => true)?.props?.href as string | undefined) ?? "" };
    };

    // 完全沒補填的舊生
    currentUser = user(1);
    const mc1 = await run(() => MyCourses());
    check("U1（沒有任何補填資料）進『我的課程』→ 直達，不被導走", !mc1.redirect && !mc1.error, JSON.stringify({ r: mc1.redirect, e: mc1.error }));
    const rem1 = await reminderOf(mc1.value);
    check("『我的課程』頁有補填提醒、連到 /complete-profile?next=/my-courses", rem1.present && rem1.rendered && rem1.href === "/complete-profile?next=%2Fmy-courses", JSON.stringify(rem1));

    const l1 = await run(() => Learn({ params: Promise.resolve({ courseSlug: course.slug }), searchParams: Promise.resolve({}) }));
    check("U1 進『上課頁』→ 直達播放頁，不被導走", !l1.redirect && !l1.error && !!find(l1.value, (el) => el.type === "iframe"), JSON.stringify({ r: l1.redirect, e: l1.error }));
    const lrem = await reminderOf(l1.value);
    check("上課頁有補填提醒、next 指回這一堂課", lrem.present && lrem.rendered && lrem.href === `/complete-profile?next=${encodeURIComponent(`/learn/${course.slug}`)}`, JSON.stringify(lrem));
    const l1b = await run(() => Learn({ params: Promise.resolve({ courseSlug: course.slug }), searchParams: Promise.resolve({ lesson: "x&y=1" }) }));
    const lremB = await reminderOf(l1b.value);
    check("帶 ?lesson= 查詢字串的上課頁，提醒的 next 會被安全編碼（不會多出一個參數）", lremB.present && lremB.rendered && !lremB.href.includes("&y=1") && lremB.href.startsWith("/complete-profile?next="), lremB.href);

    const d1 = await run(() => Dashboard());
    check("U1 進『會員中心』→ 直達，且有補填提醒", !d1.redirect && !d1.error && (await reminderOf(d1.value)).present, JSON.stringify({ r: d1.redirect, e: d1.error }));

    // 有手機沒同意
    currentUser = user(2);
    const mc2 = await run(() => MyCourses());
    check("U2（有手機沒同意）：直達且有提醒（同意仍算未補齊）", !mc2.redirect && (await reminderOf(mc2.value)).rendered === true);

    // 已補齊
    currentUser = user(3);
    const mc3 = await run(() => MyCourses());
    const r3 = await reminderOf(mc3.value);
    check("U3（已補齊）：直達，且提醒不出現（元件存在但回傳 null）", !mc3.redirect && r3.present && r3.rendered === false, JSON.stringify(r3));
    const l3 = await run(() => Learn({ params: Promise.resolve({ courseSlug: course.slug }), searchParams: Promise.resolve({}) }));
    check("U3 上課頁：直達、提醒不出現", !l3.redirect && (await reminderOf(l3.value)).rendered === false);

    // 沒買課：觀看權限這道真正的閘門仍在
    currentUser = user(4);
    const l4 = await run(() => Learn({ params: Promise.resolve({ courseSlug: course.slug }), searchParams: Promise.resolve({}) }));
    check("U4（沒開通這門課）進上課頁 → 仍然被導回課程頁（觀看權限沒被拆掉）", l4.redirect === `/courses/${course.slug}`, JSON.stringify(l4));
    currentUser = null;
    const lanon = await run(() => Learn({ params: Promise.resolve({ courseSlug: course.slug }), searchParams: Promise.resolve({}) }));
    check("未登入進上課頁 → 導去 /login", lanon.redirect === "/login", JSON.stringify(lanon));
    const mcanon = await run(() => MyCourses());
    check("未登入進我的課程 → 導去 /login", mcanon.redirect === "/login");
  }

  // ═══ D ═══
  console.log("\nD. 提醒元件");
  {
    const rem = await (ProfileReminder as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ userId: U(1), nextPath: "//evil.example.test/x" });
    const href = find(rem, () => true)?.props?.href as string;
    check("惡意 next（//evil.example.test）只會被當成編碼過的參數，連結固定是站內 /complete-profile", href.startsWith("/complete-profile?next=") && !href.includes("//evil.example.test"), href);
    const client = readFileSync("src/components/member/profile-reminder-client.tsx", "utf8");
    check("關閉記憶 7 天（只在 0 ≤ 已過時間 < 7 天內隱藏）", /DISMISS_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(client) && /elapsed >= 0 && elapsed < DISMISS_MS/.test(client));
    check("localStorage 讀寫都包 try/catch（無痕模式或被封鎖時提醒照常顯示）", (client.match(/try \{/g) ?? []).length >= 2 && (client.match(/catch/g) ?? []).length >= 2);
    check("提醒不是 modal、不擋操作：沒有 fixed／inset／z- 全螢幕覆蓋樣式", !/fixed|inset-0|z-\d+|role="dialog"/.test(client));
    const failOpen = await (async () => {
      const orig = prisma.memberProfile.findUnique;
      (prisma.memberProfile as { findUnique: unknown }).findUnique = async () => { throw new Error("db down"); };
      console.error = () => undefined;
      try { return await (ProfileReminder as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ userId: U(1), nextPath: "/dashboard" }); }
      finally { console.error = quiet; (prisma.memberProfile as { findUnique: unknown }).findUnique = orig; }
    })();
    check("資料庫瞬斷時提醒 fail-open（不顯示、不丟錯），不影響看影片", failOpen === null);
  }

  // ═══ E ═══
  console.log("\nE. 結帳前置閘門保留");
  {
    const { createCheckout } = await import("../src/actions/checkout");
    currentUser = user(4); // U4：沒有 MemberProfile 列
    const r4 = await createCheckout(course.id);
    check("沒有任何補填資料的會員結帳 → 被導去補填頁，next 指回課程頁，且沒建立訂單",
      !r4.ok && (r4 as { redirect?: string }).redirect === `/complete-profile?next=${encodeURIComponent(`/courses/${course.slug}`)}` && (await prisma.order.count({ where: { userId: U(4) } })) === 0, JSON.stringify(r4));
    await prisma.enrollment.deleteMany({ where: { userId: U(5) } });
    currentUser = user(5); // U5：有同意但沒有姓名
    const r5 = await createCheckout(course.id);
    check("有同意但缺姓名的會員結帳 → 仍被導去補填頁", !r5.ok && /complete-profile/.test((r5 as { redirect?: string }).redirect ?? ""), JSON.stringify(r5));
    await prisma.memberProfile.deleteMany({ where: { userId: U(2) } });
    await prisma.memberProfile.create({ data: { userId: U(2), phone: "0900000401", name: "有姓名有手機" } });
    await prisma.enrollment.deleteMany({ where: { userId: U(2) } });
    currentUser = user(2);
    console.error = () => undefined;
    const r2 = await run(() => createCheckout(course.id));
    console.error = quiet;
    const redirectedToProfile = !!r2.value && !r2.value.ok && /complete-profile/.test((r2.value as { redirect?: string }).redirect ?? "");
    check("有姓名有手機（即使沒勾同意）的會員結帳 → 不再被補填頁攔下（會繼續進到金流建單）", !redirectedToProfile, JSON.stringify(r2).slice(0, 160));
  }

  // ═══ F ═══
  console.log("\nF. 補填頁");
  {
    currentUser = user(1);
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    const target = `/learn/${course.slug}?lesson=abc`;
    const ok = await run(() => auth.completeProfileAction({} as never, fd({ name: "王補填", phone: "0900000410", privacyConsent: "on", consent: "on", next: target })));
    const prof = await prisma.memberProfile.findUnique({ where: { userId: U(1) } });
    check("U1 主動補填 → 寫入姓名、手機與同意時間，並導回原頁（保留 ?lesson= 查詢字串）", ok.redirect === target && prof?.name === "王補填" && !!prof.privacyConsentAt, JSON.stringify({ ok, name: prof?.name, consent: !!prof?.privacyConsentAt }));
    const after = await (ProfileReminder as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ userId: U(1), nextPath: "/dashboard" });
    check("補齊之後，提醒消失", after === null);
    currentUser = user(5);
    for (const evil of ["//evil.example.test/x", "/\\evil.example.test", "https://evil.example.test", "javascript:alert(1)"]) {
      const r = await run(() => auth.completeProfileAction({} as never, fd({ name: "測試", phone: "0900000411", privacyConsent: "on", consent: "on", next: evil })));
      check(`補填後的惡意 next（${evil}）→ 退回預設 /dashboard，不跳外站`, r.redirect === "/dashboard" || (!!r.value && "error" in (r.value as object)), JSON.stringify(r));
    }
    check("補填頁檔案仍在", readFileSync("src/app/(auth)/complete-profile/page.tsx", "utf8").length > 0);
  }

  await cleanup();
  console.log("\n  （測試資料已清理）");
}

main()
  .catch((e) => {
    fail++;
    console.error("✗ 例外：", e);
  })
  .finally(async () => {
    console.error = quiet;
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
