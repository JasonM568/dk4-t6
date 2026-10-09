/* R14 的 D 層（破壞性）驗證：講義下載授權＋剪報圖片網址——會寫入資料庫，**只能對本機 localhost 跑**。
 *
 * 決策（Jason）：講義網址要設觀看權限；剪報不能洩漏會員 IP（不載入第三方主機的圖片）。
 *
 *  M  GET /api/materials/[id]（直接呼叫路由，Storage 與登入以本機替身）
 *     M1 未登入：一律 302 /login，不洩漏任何講義是否存在
 *     M2 已登入但沒有權限：404，且與『查無此講義』的回應完全一樣（沒有存在性探針）
 *     M3 有權限：302 到 60 秒內的簽名網址；簽名只用 DB 裡的 storagePath；永遠 no-store
 *     M4 惡意 id：SQL、超長、NUL → 404，不 500
 *     M5 舊資料的外部網址：只放行 http(s)；javascript:／data:／file:／協定相對網址／含換行一律不轉址
 *     M6 storagePath 優先：兩者並存時不會轉去公開網址；Storage 失敗回 502 且不洩漏錯誤
 *     M7 跨課程、撤銷開通、專區停用、後台角色
 *     M8 靜態：前台與後台連結都走 /api/materials/<id>；bucket 私有；沒有任何地方對講義 bucket 取公開網址
 *  B  剪報圖片網址（createTodayDailyBrief／updateDailyBrief）
 *     B1 只收本站 course-assets 公開 bucket 的上傳網址，任何一張不符整筆拒絕且零寫入
 *     B2 繞過手法：冒充主機、userinfo、同網域字尾、路徑穿越、編碼穿越、http、大小寫、空白、其他 bucket
 *     B3 頁面輸出：舊資料裡的第三方圖片網址不應再被輸出給會員（寫入端擋住不等於舊資料乾淨）
 *
 * 跑法：npx tsx --conditions=react-server scripts/test-material-brief-abuse-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import { readFileSync } from "node:fs";
import Module from "node:module";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

// 剪報的『本站網址』判斷讀 NEXT_PUBLIC_SUPABASE_URL；本機 .env 帶的是正式專案代碼，這裡改成假網域
const OUR = "https://qa-fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = OUR;

// ── 本機替身 ──
let currentUser: { id: string; email: string } | null = null;
let staffRole: "admin" | "operator" | "coach" | null = null;
let storageFails = false;
const signCalls: { bucket: string; path: string; seconds: number }[] = [];
type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request === "@/lib/supabase/server") return { getAuthUser: async () => currentUser, createClient: async () => ({}) };
  if (request === "@/lib/auth/staff") {
    const ok = async () => "admin";
    return { getStaffRole: async () => staffRole, currentStaffRole: async () => staffRole, requireEditor: ok, requireStaff: ok, requireFullAdmin: ok };
  }
  if (request === "@/lib/supabase/admin") {
    return new Proxy(
      {
        COURSE_MATERIALS_BUCKET: "course-materials",
        createAdminClient: () => ({
          storage: {
            from: (bucket: string) => ({
              createSignedUrl: async (path: string, seconds: number) => {
                signCalls.push({ bucket, path, seconds });
                return storageFails ? { data: null, error: { message: "SECRET-INTERNAL-ERROR-DETAIL" } } : { data: { signedUrl: `https://storage.local/signed/${path}?token=t&exp=${seconds}` }, error: null };
              },
            }),
          },
        }),
      },
      { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`漏網：呼叫了 supabase/admin.${String(k)}`); }) },
    );
  }
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/navigation") return { redirect(u: string) { throw new Error(`NEXT_REDIRECT:${u}`); }, notFound() { throw new Error("NEXT_NOT_FOUND"); } };
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

const PID = process.pid;
const P = `tmb${PID}-`;
const U = (n: number) => `00000000-0000-4000-8000-${String(5000 + n).padStart(12, "0")}`;
const USERS = [U(1), U(2), U(3), U(4)];
const quiet = console.error;

async function cleanup() {
  await prisma.dailyBriefImage.deleteMany({ where: { brief: { group: { slug: { startsWith: P } } } } });
  await prisma.dailyBrief.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.enrollment.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.courseMaterial.deleteMany({ where: { course: { slug: { startsWith: P } } } });
  await prisma.courseGroupMember.deleteMany({ where: { group: { slug: { startsWith: P } } } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.courseGroup.deleteMany({ where: { slug: { startsWith: P } } });
}

async function main() {
  const { GET } = await import("../src/app/api/materials/[id]/route");
  const route = (await import("../src/app/api/materials/[id]/route")) as Record<string, unknown>;
  const { NextRequest } = await import("next/server");
  const call = async (id: string) => {
    const res = await GET(new NextRequest(`http://localhost:3000/api/materials/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });
    return { status: res.status, location: res.headers.get("location") ?? "", cache: res.headers.get("cache-control") ?? "", body: await res.text() };
  };
  await cleanup();

  const base = { description: "測試", price: 100, isPublished: true };
  const courseA = await prisma.course.create({ data: { ...base, id: `${P}a`, slug: `${P}a`, title: "講義課 A" } });
  const courseB = await prisma.course.create({ data: { ...base, id: `${P}b`, slug: `${P}b`, title: "講義課 B" } });
  const deadGroup = await prisma.courseGroup.create({ data: { slug: `${P}dead`, name: "停用專區", kind: "SUBSCRIPTION", isActive: false } });
  const zoneCourse = await prisma.course.create({ data: { ...base, id: `${P}z`, slug: `${P}z`, title: "專區課", groupId: deadGroup.id } });
  const mk = (courseId: string, data: Record<string, unknown>) => prisma.courseMaterial.create({ data: { courseId, title: "講義", ...data } as never });
  const matStore = await mk(courseA.id, { storagePath: `${P}a/file.pdf`, url: null });
  const matBoth = await mk(courseA.id, { storagePath: `${P}a/both.pdf`, url: "https://public.example.test/leak.pdf" });
  const matExt = await mk(courseA.id, { url: "https://drive.example.test/doc" });
  const matB = await mk(courseB.id, { storagePath: `${P}b/file.pdf`, url: null });
  const matZone = await mk(zoneCourse.id, { storagePath: `${P}z/file.pdf`, url: null });
  const bad: [string, string][] = [
    ["javascript:", "javascript:alert(document.cookie)"], ["data:", "data:text/html,<script>alert(1)</script>"], ["file:", "file:///etc/passwd"],
    ["協定相對網址", "//evil.example.test/x"], ["含換行", "https://ok.example.test/\r\nSet-Cookie: a=b"], ["大寫 JAVASCRIPT", "JAVASCRIPT:alert(1)"], ["前置空白的 javascript", " javascript:alert(1)"],
  ];
  const badMats: Record<string, string> = {};
  for (const [label, url] of bad) badMats[label] = (await mk(courseA.id, { url })).id;
  const matNone = await mk(courseA.id, { url: null, storagePath: null });

  await prisma.enrollment.create({ data: { userId: U(1), courseId: courseA.id, source: "PURCHASE" } });
  await prisma.enrollment.create({ data: { userId: U(3), courseId: courseA.id, source: "PURCHASE" } });
  const owner = { id: U(1), email: `owner${P}@localhost.test` };
  const stranger = { id: U(2), email: `stranger${P}@localhost.test` };

  // ═══ M1 ═══
  console.log("\nM1. 未登入");
  {
    currentUser = null;
    staffRole = null;
    const real = await call(matStore.id);
    const fake = await call("no-such-material-id");
    check("未登入：302 到 /login，no-store", real.status === 302 && /\/login$/.test(real.location) && /no-store/.test(real.cache), JSON.stringify(real));
    check("未登入：存在的講義與不存在的講義回應完全相同（不洩漏存在性）", real.status === fake.status && real.location === fake.location && real.body === fake.body && real.cache === fake.cache);
    check("未登入不會呼叫 Storage 簽名", signCalls.length === 0);
  }

  // ═══ M2/M3 ═══
  console.log("\nM2／M3. 沒權限與有權限");
  {
    currentUser = stranger;
    const denied = await call(matStore.id);
    const none = await call("no-such-material-id");
    check("已登入但沒開通該課 → 404、空 body、no-store", denied.status === 404 && denied.body === "" && /no-store/.test(denied.cache), JSON.stringify(denied));
    check("沒權限與『查無此講義』的回應完全一樣（沒有存在性探針）", denied.status === none.status && denied.body === none.body && denied.cache === none.cache && denied.location === none.location);
    check("沒權限時不呼叫 Storage 簽名", signCalls.length === 0);

    currentUser = owner;
    signCalls.length = 0;
    const ok = await call(matStore.id);
    check("已開通 → 302 到簽名網址、no-store", ok.status === 302 && ok.location.startsWith("https://storage.local/signed/") && /no-store/.test(ok.cache), JSON.stringify(ok));
    check("簽名只用 DB 裡的 storagePath、私有 bucket course-materials", signCalls.length === 1 && signCalls[0].bucket === "course-materials" && signCalls[0].path === `${P}a/file.pdf`, JSON.stringify(signCalls));
    check("簽名有效期 ≤ 60 秒（過期失效由 Supabase 負責；這裡確認我們只要求 60 秒）", signCalls[0]?.seconds <= 60 && signCalls[0]?.seconds > 0, String(signCalls[0]?.seconds));
    check("轉址目標是簽名網址，不是講義的公開網址", !ok.location.includes("public.example.test"));
  }

  // ═══ M4 ═══
  console.log("\nM4. 惡意 id");
  {
    currentUser = owner;
    console.error = () => undefined;
    for (const [label, id] of [["SQL 字樣", "' OR '1'='1"], ["引號與分號", "x'; DROP TABLE \"CourseMaterial\"; --"], ["1 萬字元", "A".repeat(10_000)], ["路徑穿越", "../../etc/passwd"], ["空字串", ""], ["NUL 字元", "ab\u0000cd"], ["emoji", "🍣".repeat(20)]] as const) {
      let r: { status: number } | { threw: string };
      try { r = await call(id); } catch (e) { r = { threw: String(e).slice(0, 60) }; }
      check(`${label} → 404，不 500、不 throw`, "status" in r && r.status === 404, JSON.stringify(r));
    }
    console.error = quiet;
  }

  // ═══ M5 ═══
  console.log("\nM5. 舊資料的外部網址");
  {
    currentUser = owner;
    const ext = await call(matExt.id);
    check("正常的外部 https 網址（舊資料）→ 仍然 302 過去，但要經過權限檢查", ext.status === 302 && ext.location === "https://drive.example.test/doc" && /no-store/.test(ext.cache), JSON.stringify(ext));
    currentUser = stranger;
    const extDenied = await call(matExt.id);
    check("沒開通的人拿不到外部網址", extDenied.status === 404 && !extDenied.location);
    currentUser = owner;
    for (const [label] of bad) {
      let r: { status: number; location: string } | { threw: string };
      try { r = await call(badMats[label]); } catch (e) { r = { threw: String(e).slice(0, 80) }; }
      const safe = "status" in r && (r.status === 404 || !/^(javascript|data|file):/i.test(r.location)) && !("location" in r && /^(javascript|data|file):|^\/\//i.test(r.location)) && !("status" in r && r.status >= 500);
      check(`外部網址是 ${label} → 不轉址到危險目標、不 500`, safe, JSON.stringify(r));
    }
    const none = await call(matNone.id);
    check("沒有 storagePath 也沒有網址 → 404", none.status === 404);
  }

  // ═══ M6 ═══
  console.log("\nM6. storagePath 優先與 Storage 失敗");
  {
    currentUser = owner;
    signCalls.length = 0;
    const both = await call(matBoth.id);
    check("storagePath 與公開網址並存 → 只走簽名網址，不會轉去公開直連", both.status === 302 && both.location.startsWith("https://storage.local/signed/") && !both.location.includes("public.example.test") && signCalls[0]?.path === `${P}a/both.pdf`, JSON.stringify(both));
    storageFails = true;
    console.error = () => undefined;
    const fail502 = await call(matStore.id);
    console.error = quiet;
    storageFails = false;
    check("Storage 簽名失敗 → 502、no-store、body 不洩漏內部錯誤", fail502.status === 502 && !fail502.body.includes("SECRET-INTERNAL") && /no-store/.test(fail502.cache), JSON.stringify(fail502));
    check("路由只匯出 GET（POST／PUT／DELETE 不存在）", typeof route.GET === "function" && !route.POST && !route.PUT && !route.DELETE && !route.PATCH);
  }

  // ═══ M7 ═══
  console.log("\nM7. 跨課程、撤銷、專區、角色");
  {
    currentUser = owner;
    check("開通 A 課不能下載 B 課的講義", (await call(matB.id)).status === 404);
    currentUser = { id: U(3), email: `u3${P}@localhost.test` };
    check("另一位已開通 A 課的人可以下載 A 課講義", (await call(matStore.id)).status === 302);
    await prisma.enrollment.deleteMany({ where: { userId: U(3) } });
    check("撤銷開通後立刻不能下載", (await call(matStore.id)).status === 404);
    await prisma.courseGroupMember.create({ data: { groupId: deadGroup.id, email: `u3${P}@localhost.test`, source: "MANUAL" } });
    check("專區已停用：即使是專區成員也不能下載專區課講義", (await call(matZone.id)).status === 404);
    currentUser = stranger;
    for (const role of ["coach", "operator", "admin"] as const) {
      staffRole = role;
      check(`後台角色 ${role} 可下載（預覽用）`, (await call(matStore.id)).status === 302);
    }
    staffRole = null;
    check("沒有任何角色的陌生人仍然是 404", (await call(matStore.id)).status === 404);
  }

  // ═══ M8 ═══
  console.log("\nM8. 靜態契約");
  {
    const learn = readFileSync("src/app/(member)/learn/[courseSlug]/page.tsx", "utf8");
    const section = readFileSync("src/app/(admin)/admin/courses/[id]/materials-section.tsx", "utf8");
    check("學員上課頁：講義連結走 /api/materials/<id>，不輸出講義的 url 或 storagePath", /\/api\/materials\/\$\{m\.id\}/.test(learn) && !/href=\{m\.url\}|m\.storagePath/.test(learn));
    check("後台講義列表：同樣走 /api/materials/<id>", /\/api\/materials\/\$\{m\.id\}/.test(section) && !/href=\{m\.url\}/.test(section));
    const admin = readFileSync("src/lib/supabase/admin.ts", "utf8");
    check("講義 bucket 以 public: false 建立", /createBucket\(COURSE_MATERIALS_BUCKET,\s*\{[^}]*public:\s*false/.test(admin));
    check("沒有任何程式對講義 bucket 取公開網址（getPublicUrl(…COURSE_MATERIALS_BUCKET)）", !/COURSE_MATERIALS_BUCKET[\s\S]{0,200}getPublicUrl|getPublicUrl[\s\S]{0,200}COURSE_MATERIALS_BUCKET/.test(admin));
    const shop = readFileSync("src/app/(shop)/courses/[slug]/page.tsx", "utf8");
    check("公開的課程詳情頁不輸出講義（materials）", !/materials/.test(shop));
  }

  // ═══ B ═══
  console.log("\nB. 剪報圖片網址");
  {
    const { createTodayDailyBrief, updateDailyBrief } = await import("../src/actions/daily-briefs");
    const zone = await prisma.courseGroup.create({ data: { slug: `${P}zone`, name: "剪報專區", kind: "SUBSCRIPTION" } });
    const good = (n: string) => `${OUR}/storage/v1/object/public/course-assets/daily-briefs/${n}.png`;
    const form = (images: string[]) => {
      const f = new FormData();
      for (const i of images) f.append("images", i);
      return f;
    };
    const count = () => prisma.dailyBrief.count({ where: { groupId: zone.id } });

    const okRes = await createTodayDailyBrief(zone.id, zone.slug, null, form([good("a"), good("b")]));
    check("兩張本站上傳的圖片 → 成功建立", !!okRes && "success" in okRes && (await count()) === 1, JSON.stringify(okRes));
    const created = (await prisma.dailyBrief.findFirst({ where: { groupId: zone.id }, include: { images: true } }))!;
    check("兩張圖片都寫入", created.images.length === 2);

    const evil: [string, string][] = [
      ["第三方主機", "https://evil.example.test/leak.png"],
      ["追蹤像素", "https://tracker.example.test/pixel.gif?uid=1"],
      ["http（非 https）的本站", OUR.replace("https://", "http://") + "/storage/v1/object/public/course-assets/x.png"],
      ["userinfo 冒充主機", `https://qa-fake-project.supabase.co@evil.example.test/storage/v1/object/public/course-assets/x.png`],
      ["同網域字尾冒充", `${OUR}.evil.example.test/storage/v1/object/public/course-assets/x.png`],
      ["本站但別的 bucket", `${OUR}/storage/v1/object/public/other-bucket/x.png`],
      ["本站私有物件路徑", `${OUR}/storage/v1/object/sign/course-materials/x.pdf`],
      ["路徑穿越 ../", `${OUR}/storage/v1/object/public/course-assets/../other-bucket/x.png`],
      ["編碼穿越 %2e%2e", `${OUR}/storage/v1/object/public/course-assets/%2e%2e/other-bucket/x.png`],
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:image/svg+xml,<svg onload=alert(1)>"],
      ["大寫 HTTPS 主機", good("c").replace("qa-fake-project", "QA-FAKE-PROJECT")],
      ["前置空白", ` ${good("d")}`],
      ["空字串", ""],
      ["本站根目錄", `${OUR}/`],
    ];
    for (const [label, url] of evil) {
      const before = await count();
      const r = await createTodayDailyBrief(zone.id, zone.slug, null, form([url]));
      // 今天已有一則剪報，若只看『有 error 且筆數不變』會因為『今日剪報已建立』而誤判通過；所以要求錯誤訊息就是網址檢查的那一句
      const rejected = !!r && "error" in r && /站內上傳/.test(r.error ?? "") && (await count()) === before;
      check(`建立：${label} → 因『只接受站內上傳圖片』整筆拒絕、零寫入`, rejected, JSON.stringify(r));
    }
    const mixed = await createTodayDailyBrief(zone.id, zone.slug, null, form([good("e"), "https://evil.example.test/leak.png"]));
    check("建立：一張合法＋一張第三方 → 整筆拒絕（不是只丟掉壞的），錯誤是網址檢查那一句", !!mixed && "error" in mixed && /站內上傳/.test(mixed.error ?? ""));

    // 更新路徑
    for (const [label, url] of evil.slice(0, 9)) {
      const f = form([good("a"), url]);
      f.set("title", "更新");
      f.set("status", "PUBLISHED");
      const r = await updateDailyBrief(created.id, zone.slug, null, f);
      const still = await prisma.dailyBriefImage.count({ where: { briefId: created.id } });
      check(`更新：${label} → 拒絕，原本的 2 張圖片不變`, !!r && "error" in r && still === 2, `${JSON.stringify(r)} 圖片數=${still}`);
    }
    const f2 = form([good("z1"), good("z2"), good("z3")]);
    f2.set("title", "更新成功");
    f2.set("status", "PUBLISHED");
    const upOk = await updateDailyBrief(created.id, zone.slug, null, f2);
    check("更新：全部是本站網址 → 成功並換成 3 張", !!upOk && "success" in upOk && (await prisma.dailyBriefImage.count({ where: { briefId: created.id } })) === 3);

    const many = Array.from({ length: 300 }, (_, i) => good(`bulk${i}`));
    const f3 = form(many);
    f3.set("title", "大量");
    f3.set("status", "PUBLISHED");
    const bulk = await updateDailyBrief(created.id, zone.slug, null, f3);
    check("一則剪報塞 300 張圖片要有上限（例如 ≤ 30）——否則一次誤操作就能讓會員頁載入數百張圖", !!bulk && "error" in bulk, `實際接受（圖片數 ${await prisma.dailyBriefImage.count({ where: { briefId: created.id } })}）`);

    // B3：舊資料
    const page = readFileSync("src/app/(shop)/zone/[groupSlug]/briefs/page.tsx", "utf8");
    check("頁面輸出圖片前再過濾一次站內網址（舊資料可能已有第三方圖片，寫入端擋住不代表既有資料乾淨；否則會員瀏覽器仍會連到第三方主機而洩漏 IP）",
      /isOurStorageUrl/.test(page), "briefs 頁直接輸出 DB 裡的 imageUrl，沒有再檢查");
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
