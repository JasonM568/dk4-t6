/* 公開表單與登入入口的 D 層（破壞性）驗證——會寫入資料庫，**只能對本機 localhost 跑**。
 *
 * 這些入口不用登入、會寄信或寫入資料庫，是最容易被濫用的地方。直接呼叫 server action（繞過畫面）：
 *
 *  W  講座索取：基準、同信箱併發（轟炸）、覆寫他人資料、畸形與超長欄位、關閉與蜜罐、問卷竄改
 *  C  企業包班詢問：基準、併發連送、欄位上限與白名單、通知信內容
 *  R  註冊與忘記密碼：（Supabase 一律換成本機假實作，絕不碰正式專案）
 *       輸入防線、以別人的手機號碼註冊能否認領對方的上課紀錄、帳號枚舉、退訂頁 action
 *  L  上課碼 /live 與看板 /board 的 4 位碼登入：循序暴力、以及『一次併發很多個猜測』能否繞過限流
 *
 * 不碰任何外部服務：
 *   - Resend → 本機假伺服器（RESEND_BATCH_URL）
 *   - Supabase Auth／Admin → Module._load 換成本機假實作（admin 模組任何呼叫都直接丟錯，確保沒有漏網）
 *   - NEXT_PUBLIC_SUPABASE_URL 在本程序內改指向 127.0.0.1:1（死埠）
 *   - next/headers、next/cache、next/navigation 全部本機替身
 * 跑法：npx tsx --conditions=react-server scripts/test-public-forms-abuse-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY；本檔會自己設定假的值） */
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import Module from "node:module";

// 本程序內先把 Supabase 指向死埠：萬一有漏網的呼叫，也只會失敗而不是打到正式專案
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "x";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "x";
process.env.SUPABASE_SECRET_KEY = "";

// ── 本機替身 ──
const supa = {
  signUp: [] as { email: string; password: string; name: string }[],
  reset: [] as string[],
  resetImpl: (): { error: { status?: number; code?: string; message?: string } | null } => ({ error: null }),
  nextId: 3000,
};
let currentIp = "198.51.100.10";
const uuidN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const testUserIds = () => Array.from({ length: 300 }, (_, i) => uuidN(3001 + i));
const jarSets: { name: string; value: string }[] = [];
const fakeSupabaseClient = {
  auth: {
    signUp: async (a: { email: string; password: string; options?: { data?: { display_name?: string } } }) => {
      supa.signUp.push({ email: a.email, password: a.password, name: a.options?.data?.display_name ?? "" });
      const id = uuidN(++supa.nextId);
      return { data: { user: { id, identities: [{}] }, session: null }, error: null };
    },
    resetPasswordForEmail: async (email: string) => {
      supa.reset.push(email);
      return supa.resetImpl();
    },
    signOut: async () => ({}),
    signInWithPassword: async () => ({ data: {}, error: { code: "invalid_credentials", status: 400 } }),
  },
};
type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/auth/staff") {
    const ok = async () => "admin";
    return { requireEditor: ok, requireStaff: ok, requireFullAdmin: ok, currentStaffRole: async () => null };
  }
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/navigation") return { redirect(u: string) { throw new Error(`NEXT_REDIRECT:${u}`); }, notFound() { throw new Error("NEXT_NOT_FOUND"); } };
  if (request === "next/headers") {
    return {
      headers: async () => new Headers({ "x-real-ip": currentIp }),
      cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => { jarSets.push({ name, value }); }, delete() {} }),
    };
  }
  if (request === "@/lib/supabase/server") return { createClient: async () => fakeSupabaseClient, getAuthUser: async () => null };
  if (request === "@/lib/supabase/admin") {
    return new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : () => { throw new Error(`漏網：呼叫了 supabase/admin.${String(k)}`); }) });
  }
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

// ── 假 Resend ──
const mails: { to: string; subject: string; html: string }[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const msgs = JSON.parse(raw) as { to: string | string[]; subject: string; html: string }[];
    for (const m of msgs) mails.push({ to: String(Array.isArray(m.to) ? m.to[0] : m.to).toLowerCase(), subject: m.subject, html: m.html ?? "" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: msgs.map((_, i) => ({ id: `mock-${mails.length}-${i}` })) }));
  });
});

const D = "@pf-abuse.localhost";
const WSLUG = "test-pf-webinar";
const quiet = console.error;
const log = console.log;
// 每次執行用自己的來源 IP 與碼：兩份同時跑（或別人同時跑）不會踩到彼此的限流計數與唯一鍵
const PID = process.pid;
const BOARD_IP = `198.51.100.${PID}-board`;
const LIVE_IP = `198.51.100.${PID}-live`;
const LIVE_CODE = String(1000 + (PID % 8000));
const BOARD_CODE = String(2000 + ((PID * 7) % 7000));
const PHONE_VICTIM = "0900000301";
const createdUsers = () => supa.signUp.length;

async function cleanup() {
  await prisma.webinarBlockedAttempt.deleteMany({ where: { webinar: { slug: WSLUG } } });
  await prisma.webinarRequest.deleteMany({ where: { webinar: { slug: WSLUG } } });
  await prisma.webinarQuestion.deleteMany({ where: { webinar: { slug: WSLUG } } });
  await prisma.webinar.deleteMany({ where: { slug: WSLUG } });
  await prisma.corporateInquiry.deleteMany({ where: { email: { endsWith: D } } });
  await prisma.siteSetting.deleteMany({ where: { key: "corporateNotifyEmail" } });
  await prisma.mailUnsubscribe.deleteMany({ where: { email: { endsWith: D } } });
  await prisma.memberProfile.deleteMany({ where: { userId: { in: testUserIds() } } });
  await prisma.studentCourseHistory.deleteMany({ where: { student: { phone: PHONE_VICTIM } } });
  await prisma.studentRecord.deleteMany({ where: { phone: { in: [PHONE_VICTIM, "0900000302", "0900000303"] } } });
  await prisma.registerAttempt.deleteMany({ where: { email: { endsWith: D } } });
  await prisma.courseSession.deleteMany({ where: { id: `test-pf-live-${PID}` } });
  await prisma.boardLoginThrottle.deleteMany({ where: { key: { in: [`ip:${BOARD_IP}`, `live-ip:${LIVE_IP}`] } } });
}

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
let phoneSeq = 0;
const phone = () => `09${String(50_000_000 + ++phoneSeq).padStart(8, "0")}`;
const mailsTo = (e: string) => mails.filter((m) => m.to === e.toLowerCase()).length;
const settle = <T,>(p: Promise<T>) => p.catch((e) => ({ threw: String(e).slice(0, 80) }) as unknown as T);

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  process.env.RESEND_BATCH_URL = `http://127.0.0.1:${port}`;
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "Test <test@example.com>";
  process.env.UNSUBSCRIBE_SECRET = "u".repeat(48);
  process.env.BOARD_SESSION_SECRET = "b".repeat(48);
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";

  const { requestWebinarLinkAction } = await import("../src/actions/webinar");
  const { submitCorporateInquiryAction } = await import("../src/actions/corporate");
  const { registerAction, forgotPasswordAction, unsubscribeAction } = await import("../src/actions/auth");
  const { liveLoginAction } = await import("../src/actions/live");
  const { boardLoginAction } = await import("../src/actions/board");
  const { unsubscribeToken } = await import("../src/lib/email/unsubscribe");
  await cleanup();

  // ═══════════════ W ═══════════════
  console.log("\nW. 講座索取（requestWebinarLinkAction）");
  const webinar = await prisma.webinar.create({
    data: { slug: WSLUG, title: "公開表單測試講座", description: "測試用", lectureUrl: "https://example.test/z", emailSubject: "您的講座連結", emailBody: "{name} 您好，連結：{link}", isActive: true },
  });
  const q1 = await prisma.webinarQuestion.create({ data: { webinarId: webinar.id, label: "單選題", type: "SINGLE", options: ["甲", "乙"], required: true, sortOrder: 0 } });
  const qf = (id: string) => `q_${id}`;
  const wf = (o: Record<string, string | string[]> = {}) => fd({ name: "王小明", email: `w1${D}`, phone: phone(), [qf(q1.id)]: "甲", ...o });
  {
    const r = await requestWebinarLinkAction(WSLUG, null, wf());
    check("基準：正常索取 → 成功、寄 1 封、寫入索取紀錄", !!r && "success" in r && mailsTo(`w1${D}`) === 1 && (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 1, JSON.stringify(r));

    const email = `w2${D}`;
    await Promise.all(Array.from({ length: 5 }, () => requestWebinarLinkAction(WSLUG, null, wf({ email, name: "併發" }))));
    check("同一個信箱併發送出 5 次 → 只寄 1 封（60 秒冷卻不能被併發繞過；否則可被拿來轟炸別人的信箱）", mailsTo(email) <= 1, `實際寄出 ${mailsTo(email)} 封`);

    // 覆寫他人資料：先有一筆真實索取，隔了冷卻期後同信箱不同姓名／手機再送
    const victim = `w3${D}`;
    const realPhone = "0900000311";
    await requestWebinarLinkAction(WSLUG, null, wf({ email: victim, name: "真實本人", phone: realPhone }));
    await prisma.webinarRequest.updateMany({ where: { email: victim }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    await requestWebinarLinkAction(WSLUG, null, wf({ email: victim, name: "冒名者", phone: "0900000312" }));
    const row = await prisma.webinarRequest.findFirst({ where: { email: victim } });
    check("【待確認】知道他人信箱的人重送表單，不應能把對方已留的姓名與手機改掉（開課前簡訊會改發到冒名者的手機）", row?.name === "真實本人" && row?.phone === realPhone, `現在是 姓名=${row?.name} 手機=${row?.phone}（以最新一次為準）`);

    const src = readFileSync("src/actions/webinar.ts", "utf8");
    const body = src.slice(src.indexOf("export async function requestWebinarLinkAction"), src.indexOf("export async function getWebinarDeliveryStatusAction"));
    check("【現行行為，待 Jason 決定（Turnstile 或沿用 BoardLoginThrottle）】公開表單目前沒有每 IP／全域速率限制，只有蜜罐＋同信箱 60 秒冷卻；若日後加了限流，這項要改成斷言它存在", !/headers\(|Throttle|rateLimit|RateLimit/.test(body), "已偵測到限流程式碼——請把這項改成『限流存在』並補實測");

    // 畸形與超長
    const long = await settle(requestWebinarLinkAction(WSLUG, null, wf({ email: `w4${D}`, name: "長".repeat(100_000) })));
    const lr = await prisma.webinarRequest.findFirst({ where: { email: `w4${D}` } });
    check("超長姓名（10 萬字）不 throw", !(long && typeof long === "object" && "threw" in (long as object)), JSON.stringify(long).slice(0, 100));
    check("超長姓名要被拒絕或截斷（≤ 50 字），不可原樣存入並寫進寄出的信", !lr || (lr.name?.length ?? 0) <= 50, `存入 ${lr?.name?.length} 字`);
    for (const [label, over] of [
      ["信箱含換行", { email: `a${D}\r\nBcc: v@x.com` }],
      ["信箱超長（1 萬字）", { email: "x".repeat(10_000) + D }],
      ["手機含字母", { phone: "09abc12345" }],
      ["姓名空白", { name: "   " }],
    ] as const) {
      const before = mails.length;
      const r = await settle(requestWebinarLinkAction(WSLUG, null, wf(over as Record<string, string>)));
      check(`${label} → 拒絕、零寄信、不 throw`, !!r && typeof r === "object" && "error" in (r as object) && mails.length === before, JSON.stringify(r).slice(0, 100));
    }
    console.error = () => undefined;
    const nul = await settle(requestWebinarLinkAction(WSLUG, null, wf({ email: `w5${D}`, name: "王\u0000明" })));
    console.error = quiet;
    check("姓名含 NUL 字元 → 不 throw（回友善錯誤或成功皆可）", !(nul && typeof nul === "object" && "threw" in (nul as object)), JSON.stringify(nul).slice(0, 100));

    // 問卷竄改
    const tamper = `w6${D}`;
    await requestWebinarLinkAction(WSLUG, null, wf({ email: tamper, [qf(q1.id)]: "丙（不在選項內）" }));
    check("單選題送出不在選項內的值 → 視同未作答，必填被擋下、零寄信", mailsTo(tamper) === 0);
    await requestWebinarLinkAction(WSLUG, null, wf({ email: tamper, [qf(q1.id)]: ["甲", "乙", "甲"] }));
    const t = await prisma.webinarRequest.findFirst({ where: { email: tamper } });
    check("單選題塞多個值 → 只收第 1 個", JSON.stringify((t?.answers as { value: string[] }[] | null)?.[0]?.value) === JSON.stringify(["甲"]), JSON.stringify(t?.answers));

    // 關閉與蜜罐
    const hp = `w7${D}`;
    const before = mails.length;
    const hr = await requestWebinarLinkAction(WSLUG, null, wf({ email: hp, hp_extra_note: "spam" }));
    check("蜜罐觸發 → 回成功、零寄信、留下被擋下紀錄（不是無聲消失）", !!hr && "success" in hr && mails.length === before && (await prisma.webinarBlockedAttempt.count({ where: { webinar: { slug: WSLUG } } })) >= 1);
    await prisma.webinar.update({ where: { id: webinar.id }, data: { isActive: false } });
    const cr = await requestWebinarLinkAction(WSLUG, null, wf({ email: `w8${D}` }));
    check("講座已停用 → 拒絕、零寄信", !!cr && "error" in cr && mailsTo(`w8${D}`) === 0);
    await prisma.webinar.update({ where: { id: webinar.id }, data: { isActive: true } });
    for (const slug of ["no-such", "", "' OR '1'='1", "a".repeat(10_000)]) {
      const r = await settle(requestWebinarLinkAction(slug, null, wf({ email: `w9${D}` })));
      check(`惡意 slug（${slug.slice(0, 12) || "空字串"}）→ 拒絕、不 throw`, !!r && typeof r === "object" && "error" in (r as object), JSON.stringify(r).slice(0, 80));
    }
  }

  // ═══════════════ C ═══════════════
  console.log("\nC. 企業包班詢問（submitCorporateInquiryAction）");
  {
    await prisma.siteSetting.upsert({ where: { key: "corporateNotifyEmail" }, update: { value: `staff${D}` }, create: { key: "corporateNotifyEmail", value: `staff${D}` } });
    const cf = (o: Record<string, string | string[]> = {}) => fd({ companyName: "測試公司", contactName: "陳先生", email: `c1${D}`, phone: "02-12345678", ...o });
    const r = await submitCorporateInquiryAction(null, cf());
    check("基準：正常送出 → 成功、入庫 1 筆、通知管理員＋自動回覆", !!r && "success" in r && (await prisma.corporateInquiry.count({ where: { email: `c1${D}` } })) === 1 && mailsTo(`staff${D}`) === 1 && mailsTo(`c1${D}`) === 1, `入庫 ${await prisma.corporateInquiry.count({ where: { email: `c1${D}` } })}、通知 ${mailsTo(`staff${D}`)}、回覆 ${mailsTo(`c1${D}`)}`);

    const e2 = `c2${D}`;
    await Promise.all(Array.from({ length: 5 }, () => submitCorporateInquiryAction(null, cf({ email: e2 }))));
    const n2 = await prisma.corporateInquiry.count({ where: { email: e2 } });
    check("同信箱併發送出 5 次 → 只入庫 1 筆（10 分鐘防重不能被併發繞過）", n2 === 1, `入庫 ${n2} 筆；寄給管理員 ${mailsTo(`staff${D}`) - 1} 封通知、寄給對方 ${mailsTo(e2)} 封自動回覆`);

    await submitCorporateInquiryAction(null, cf({
      email: `c3${D}`, companyName: "公".repeat(10_000), contactName: "聯".repeat(10_000), message: "說".repeat(100_000),
      topics: ["AI", "不存在的主題", "<script>"], headcount: "亂填的人數", budget: "亂填的預算",
    }));
    const c3 = await prisma.corporateInquiry.findFirst({ where: { email: `c3${D}` } });
    check("超長欄位被裁切（公司 ≤100、聯絡人 ≤50、說明 ≤2000）", !!c3 && c3.companyName.length <= 100 && c3.contactName.length <= 50 && (c3.message?.length ?? 0) <= 2000, `${c3?.companyName.length}／${c3?.contactName.length}／${c3?.message?.length}`);
    check("被竄改的下拉選項一律存 null、不在白名單的主題被丟掉", !!c3 && c3.headcount === null && c3.budget === null && !c3.topics.includes("不存在的主題") && !c3.topics.includes("<script>"), JSON.stringify({ h: c3?.headcount, b: c3?.budget, t: c3?.topics }));

    for (const [label, over] of [["電話含字母", { phone: "abc" }], ["信箱格式錯", { email: "nope" }], ["公司空白", { companyName: " " }]] as const) {
      const before = await prisma.corporateInquiry.count();
      const rr = await settle(submitCorporateInquiryAction(null, cf(over as Record<string, string>)));
      check(`${label} → 拒絕、零入庫`, !!rr && "error" in (rr as object) && (await prisma.corporateInquiry.count()) === before, JSON.stringify(rr).slice(0, 80));
    }

    await submitCorporateInquiryAction(null, cf({ email: `c4${D}`, message: `<img src=x onerror=alert(1)> <script>alert(2)</script>` }));
    const notice = mails.filter((m) => m.to === `staff${D}` && m.subject.includes("測試公司")).map((m) => m.html).join("\n");
    check("訪客填的說明含 HTML／腳本 → 通知信 HTML 中沒有以可執行形式出現", !/<img[^>]+onerror=/i.test(notice) && !/<script>alert\(2\)/i.test(notice), "可執行形式出現在寄給管理員的信");
    const before = mails.length;
    const hh = await submitCorporateInquiryAction(null, cf({ email: `c5${D}`, hp_extra_note: "x" }));
    check("蜜罐觸發 → 回成功、零入庫、零寄信", !!hh && "success" in hh && (await prisma.corporateInquiry.count({ where: { email: `c5${D}` } })) === 0 && mails.length === before);
  }

  // ═══════════════ R ═══════════════
  console.log("\nR. 註冊與忘記密碼（Supabase 全部是本機假實作）");
  {
    const rf = (o: Record<string, string> = {}) =>
      fd({ displayName: "測試學員", email: `r1${D}`, password: "abcdef", phone: phone(), privacyConsent: "on", ...o });
    const base = createdUsers();
    const ok = await settle(registerAction({} as never, rf()));
    check("基準：正常註冊 → 呼叫 signUp 1 次、寫入手機與同意紀錄", createdUsers() === base + 1 && !!ok && (await prisma.memberProfile.count({ where: { userId: { in: testUserIds() } } })) >= 1, JSON.stringify(ok).slice(0, 120));

    for (const [label, over] of [
      ["密碼太短", { password: "123" }], ["信箱格式錯", { email: "nope" }], ["姓名只有 1 字", { displayName: "王" }],
      ["姓名含數字與符號", { displayName: "<script>1</script>" }], ["手機缺少", { phone: "" }], ["手機含字母", { phone: "09abc12345" }],
    ] as const) {
      const b = createdUsers();
      const r = await settle(registerAction({} as never, rf({ email: `r2${D}`, ...over } as Record<string, string>)));
      check(`${label} → 拒絕，且完全沒有呼叫 Supabase signUp`, createdUsers() === b && !!r && typeof r === "object" && "error" in (r as object), JSON.stringify(r).slice(0, 100));
    }
    const b3 = createdUsers();
    await settle(registerAction({} as never, rf({ email: `r3${D}`, displayName: "長".repeat(20_000), password: "p".repeat(100_000) })));
    const sent = supa.signUp.slice(b3)[0];
    check("超長姓名（2 萬字）與超長密碼（10 萬字）要在呼叫 Supabase 前就被擋下", !sent || (sent.name.length <= 100 && sent.password.length <= 128), `送出的姓名 ${sent?.name.length} 字、密碼 ${sent?.password.length} 字`);

    // ── 以別人的手機號碼註冊：能否認領對方的上課紀錄 ──
    const victim = await prisma.studentRecord.create({ data: { phone: PHONE_VICTIM, name: "受害者本人", email: `victim-real${D}` } });
    await prisma.studentCourseHistory.create({ data: { studentId: victim.id, courseName: "私密的上課紀錄-量子課", note: "備註" } });
    await settle(registerAction({} as never, rf({ email: `attacker${D}`, displayName: "完全不同的人", phone: PHONE_VICTIM })));
    const claimed = await prisma.studentRecord.findUnique({ where: { id: victim.id } });
    check("【隱私】用別人的手機號碼註冊（姓名不同、手機沒有驗證碼）→ 不應認領對方的學員記錄；認領後攻擊者的會員中心會列出對方的上課紀錄", !claimed?.claimedUserId,
      `學員記錄 ${claimed?.name} 已被新註冊的『完全不同的人』認領（claimedUserId=${claimed?.claimedUserId}），其上課史會顯示在對方的會員中心，真本人之後註冊反而認領不到`);

    // 同一個人（姓名相符）用自己的手機註冊 → 仍然要能認領（不能矯枉過正）
    const own = await prisma.studentRecord.create({ data: { phone: "0900000302", name: "陳本人", email: `own-real${D}` } });
    await prisma.studentCourseHistory.create({ data: { studentId: own.id, courseName: "本人的課" } });
    await settle(registerAction({} as never, rf({ email: `owner${D}`, displayName: "陳本人", phone: "0900000302" })));
    check("姓名與手機都相符的真本人註冊 → 正常認領自己的學員記錄", !!(await prisma.studentRecord.findUnique({ where: { id: own.id } }))?.claimedUserId);
    const nameless = await prisma.studentRecord.create({ data: { phone: "0900000303", name: null, email: `nameless-real${D}` } });
    await settle(registerAction({} as never, rf({ email: `owner2${D}`, displayName: "王大明", phone: "0900000303" })));
    check("學員記錄沒有姓名（歷史資料不全）時，以手機認領仍然放行（不誤擋老學員）", !!(await prisma.studentRecord.findUnique({ where: { id: nameless.id } }))?.claimedUserId);
    await prisma.studentCourseHistory.deleteMany({ where: { studentId: own.id } });
    await prisma.studentRecord.deleteMany({ where: { phone: { in: ["0900000302", "0900000303"] } } });

    // 所有呼叫點都要帶會員姓名：不帶的話，有姓名的學員記錄一律拒絕認領（等於把真本人也擋掉）
    {
      const { execSync } = await import("node:child_process");
      const lines = execSync(`grep -rn "claimStudentRecord(" src --include=*.ts --include=*.tsx || true`, { encoding: "utf8" })
        .split("\n")
        .filter((l) => l && !l.includes("src/lib/student-history.ts") && !/^\S+:\d+:\s*import /.test(l));
      const missing = lines.filter((l) => !/\bname\b/.test(l));
      check("claimStudentRecord 的每個呼叫點都帶 name（姓名比對才有東西可比，否則真本人也領不到）", lines.length > 0 && missing.length === 0, missing.join(" ｜ "));
    }

    // ── 忘記密碼 ──
    const rb = supa.reset.length;
    supa.resetImpl = () => ({ error: { status: 400, code: "user_not_found", message: "no user" } });
    const unknown = await forgotPasswordAction({} as never, fd({ email: `ghost${D}` }));
    supa.resetImpl = () => ({ error: null });
    const known = await forgotPasswordAction({} as never, fd({ email: `r1${D}` }));
    check("帳號枚舉：不存在的信箱與存在的信箱回應形狀相同（都是 success）", !!unknown && "success" in unknown && !!unknown.success && !!known && "success" in known && !!known.success, JSON.stringify([unknown, known]).slice(0, 160));
    supa.resetImpl = () => ({ error: { status: 429, code: "over_email_send_rate_limit", message: "you can only request this after 53 seconds" } });
    const limited = await forgotPasswordAction({} as never, fd({ email: `r1${D}` }));
    check("Supabase 限流 429 → 回『操作太頻繁』並帶建議等待秒數 53", !!limited && "error" in limited && (limited as { retryAfter?: number }).retryAfter === 53, JSON.stringify(limited));
    supa.resetImpl = () => ({ error: null });
    const bad = supa.reset.length;
    for (const e of ["nope", "a b@c.com", `a${D}\r\nBcc: v@x.com`, "x".repeat(10_000) + D, ""]) await settle(forgotPasswordAction({} as never, fd({ email: e })));
    check("畸形信箱（無 @、空白、換行、超長、空）一律不會呼叫 Supabase", supa.reset.length === bad, `多呼叫了 ${supa.reset.length - bad} 次：${supa.reset.slice(bad).map((x) => x.slice(0, 20)).join("|")}`);
    void rb;

    // ── 退訂頁 action ──
    const email = `un1${D}`;
    const tok = unsubscribeToken(email)!;
    const call = async (e: string, t: string, reason = "") => {
      try { return await unsubscribeAction({} as never, fd({ email: e, token: t, reason })); } catch (x) { return { redirected: String(x).startsWith("Error: NEXT_REDIRECT") } as const; }
    };
    const bogus = await call(email, "0".repeat(64));
    check("偽造 token → 錯誤，且沒有寫入退訂名單", !!bogus && "error" in bogus && !(await prisma.mailUnsubscribe.findUnique({ where: { email } })));
    const good = await call(email, tok, "我要退訂".repeat(500));
    const un = await prisma.mailUnsubscribe.findUnique({ where: { email } });
    check("正確 token → 退訂成功並導向完成頁", !!good && "redirected" in good && good.redirected && !!un);
    check("退訂原因超長（2,000 字）只存前 500 字", (un?.reason?.length ?? 0) <= 500, String(un?.reason?.length));
  }

  // ═══════════════ L ═══════════════
  console.log("\nL. 4 位碼登入的暴力破解（上課碼 /live、看板 /board）");
  {
    const savedGlobal = await prisma.boardLoginThrottle.findUnique({ where: { key: "global" } });
    const savedLiveGlobal = await prisma.boardLoginThrottle.findUnique({ where: { key: "live-global" } });
    const savedCode = await prisma.siteSetting.findUnique({ where: { key: "boardCode" } });
    await prisma.siteSetting.upsert({ where: { key: "boardCode" }, update: { value: BOARD_CODE }, create: { key: "boardCode", value: BOARD_CODE } });
    await prisma.courseSession.create({
      data: { id: `test-pf-live-${PID}`, title: "上課碼測試場次", accessCode: LIVE_CODE, meetingUrl: "https://example.test/zoom", eventDate: new Date(Date.now() + 86_400_000) },
    });
    const wrongs = Array.from({ length: 59 }, (_, i) => String(1000 + i * 7).padStart(4, "0")).filter((c) => c !== LIVE_CODE && c !== BOARD_CODE);

    // 循序：連錯 5 次後，即使第 6 次輸入正確也要被擋
    currentIp = LIVE_IP;
    log("    （循序嘗試每次失敗約延遲 1 秒，請稍候）");
    for (let i = 0; i < 8; i++) await liveLoginAction(null, fd({ code: wrongs[i] }));
    jarSets.length = 0;
    const sixth = await settle(liveLoginAction(null, fd({ code: LIVE_CODE })));
    check("上課碼：連錯 8 次後第 9 次即使碼正確也被擋（循序）", jarSets.length === 0 && !!sixth && "error" in (sixth as object), JSON.stringify(sixth).slice(0, 100));

    // 併發：同一個 IP 一次送出 60 個猜測，其中最後一個是正確的碼
    await prisma.boardLoginThrottle.deleteMany({ where: { key: `live-ip:${LIVE_IP}` } });
    jarSets.length = 0;
    const live = await Promise.all([...wrongs.map((c) => settle(liveLoginAction(null, fd({ code: c })))), settle(liveLoginAction(null, fd({ code: LIVE_CODE })))]);
    const liveOk = jarSets.some((s) => s.name === "live_auth");
    const liveRow = await prisma.boardLoginThrottle.findUnique({ where: { key: `live-ip:${LIVE_IP}` } });
    check("上課碼：一次併發 60 個猜測（含正確碼）→ 限流應生效，正確碼不應通過", !liveOk,
      `正確碼在併發猜測中通過並拿到登入 cookie；60 個請求都在第 8 次失敗被記錄之前就通過了鎖定檢查，之後才記到失敗計數（failCount=${liveRow?.failCount}）。4 位數只有 1 萬種組合，攻擊者一次送出 1 萬個併發請求即可全部試完`);
    void live;

    // 鎖定到期後（模擬 15 分鐘後）正確的碼要能登入——不能把真學員永久鎖死
    await prisma.boardLoginThrottle.updateMany({ where: { key: { in: [`live-ip:${LIVE_IP}`, "live-global"] } }, data: { lockedUntil: new Date(Date.now() - 1000), failCount: 0, windowStart: new Date(Date.now() - 3_600_000) } });
    jarSets.length = 0;
    currentIp = LIVE_IP;
    const recovered = await settle(liveLoginAction({} as never, fd({ code: LIVE_CODE })));
    void recovered;
    check("上課碼：鎖定到期後，真學員輸入正確的碼可以登入（沒有被永久鎖死）", jarSets.some((x) => x.name === "live_auth"));

    currentIp = BOARD_IP;
    for (let i = 0; i < 5; i++) await boardLoginAction(null, fd({ code: wrongs[i] }));
    jarSets.length = 0;
    const bSixth = await settle(boardLoginAction(null, fd({ code: BOARD_CODE })));
    check("看板：連錯 5 次後第 6 次即使碼正確也被擋（循序）", jarSets.length === 0 && !!bSixth && typeof bSixth === "object" && !!bSixth && "error" in (bSixth as object), JSON.stringify(bSixth).slice(0, 100));
    await prisma.boardLoginThrottle.deleteMany({ where: { key: `ip:${BOARD_IP}` } });
    jarSets.length = 0;
    await Promise.all([...wrongs.map((c) => settle(boardLoginAction(null, fd({ code: c })))), settle(boardLoginAction(null, fd({ code: BOARD_CODE })))]);
    const boardOk = jarSets.some((s) => s.name === "board_auth");
    check("看板：一次併發 60 個猜測（含正確碼）→ 限流應生效，正確碼不應通過", !boardOk,
      "正確碼在併發猜測中通過並拿到看板 cookie（看板可看到所有場次的學員姓名名單）");

    // 還原
    await prisma.boardLoginThrottle.deleteMany({ where: { key: "global" } });
    if (savedGlobal) await prisma.boardLoginThrottle.create({ data: savedGlobal });
    await prisma.boardLoginThrottle.deleteMany({ where: { key: "live-global" } });
    if (savedLiveGlobal) await prisma.boardLoginThrottle.create({ data: savedLiveGlobal });
    if (savedCode) await prisma.siteSetting.update({ where: { key: "boardCode" }, data: { value: savedCode.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "boardCode" } });
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
    server.close();
    console.log(`\n結果：${pass} 通過、${fail} 失敗`);
    process.exit(fail > 0 ? 1 : 0);
  });
