/* EDM 與簡訊群發的 D 層（破壞性）驗證——會寫入資料庫，**只能對本機 localhost 跑**。
 *
 * 群發一旦寄出就收不回來，也是被客訴與退訂放大的地方。這裡直接呼叫後台 server action
 * （等同繞過畫面），並用本機假 Resend 伺服器統計「每個收件人實際收到幾封」：
 *
 *  EDM
 *   A  基準：手動名單寄出
 *   B  名單清洗：大小寫／空白／分隔符／重複／無效信箱
 *   C  連點「寄出」（同一份表單併發 3 次）→ 每人只該收到 1 封
 *   D  同一份草稿併發寄出（原子認領）、cron 重疊執行（原子認領）、補寄失敗者併發
 *   E  行銷信排除退訂者；信件帶 List-Unsubscribe 標頭
 *   F  空名單／全是無效信箱 → 拒絕且零寄出；1,200 人大名單完整寄達且不重複
 *   G  合併欄位 {name} 內含 HTML／腳本 → 不可原樣進信件
 *   H  退訂端點 /api/unsubscribe：偽造、錯人、非 hex、超長、無 secret、正規化、重放
 *  簡訊（本機測試模式 provider，不外送）
 *   N  基準、O 號碼格式去重、P 無效與海外號碼、Q 連點併發、R 退訂名單、
 *   S 超長內文的成本、T 必填檢查、U 排程到期併發、V 同一草稿併發送出
 *
 * 不碰外部服務：Resend 走本機假伺服器（RESEND_BATCH_URL）；簡訊用內建的測試模式 provider；
 * auth/staff、supabase/server、next/cache 以 Module._load 換成本機替身。
 * 跑法：npx tsx --conditions=react-server scripts/test-broadcast-abuse-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY；本檔會自己設定假的值） */
import { createServer } from "node:http";
import { once } from "node:events";
import { prisma } from "../src/lib/db";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

import Module from "node:module";

type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const M = Module as unknown as { _load: LoadFn };
const origLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/auth/staff") {
    const ok = async () => "admin";
    return { requireEditor: ok, requireStaff: ok, requireFullAdmin: ok, currentStaffRole: async () => "admin" };
  }
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/navigation") return { redirect() { throw new Error("NEXT_REDIRECT"); }, notFound() { throw new Error("NEXT_NOT_FOUND"); } };
  if (request === "@/lib/supabase/server") {
    return {
      getAuthUser: async () => ({ id: "00000000-0000-4000-8000-0000000000d1", email: "qa-admin@edm-abuse.localhost", displayName: "QA" }),
    };
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

// ── 假 Resend：統計每個收件人收到幾封，並留下標頭與 HTML ──
const mails: { to: string; subject: string; html: string; headers: Record<string, string> }[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const msgs = JSON.parse(raw) as { to: string | string[]; subject: string; html: string; headers?: Record<string, string> }[];
    for (const m of msgs) mails.push({ to: String(Array.isArray(m.to) ? m.to[0] : m.to).toLowerCase(), subject: m.subject, html: m.html ?? "", headers: m.headers ?? {} });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: msgs.map((_, i) => ({ id: `mock-${mails.length}-${i}` })) }));
  });
});
const countTo = (email: string, subject?: string) => mails.filter((m) => m.to === email.toLowerCase() && (!subject || m.subject === subject)).length;

// 每次執行用自己的前綴（pid），兩個人同時跑這支測試也不會互相清掉對方的資料
const RUN = String(process.pid);
const P = `BA${RUN}-`;
const D = `@ba${RUN}.localhost`;
const SUB = (tag: string) => `${P}${tag}`;
const MOBS = Array.from({ length: 20 }, (_, i) => `0912000${String(i + 1).padStart(3, "0")}`);
const quiet = console.error;

async function cleanup() {
  const bs = await prisma.emailBroadcast.findMany({ where: { subject: { startsWith: P } }, select: { id: true } });
  await prisma.emailBroadcastRecipient.deleteMany({ where: { broadcastId: { in: bs.map((b) => b.id) } } });
  await prisma.emailBroadcast.deleteMany({ where: { subject: { startsWith: P } } });
  await prisma.mailUnsubscribe.deleteMany({ where: { email: { endsWith: D } } });
  const sb = await prisma.smsBroadcast.findMany({ where: { title: { startsWith: P } }, select: { id: true } });
  await prisma.smsMessage.deleteMany({ where: { broadcastId: { in: sb.map((b) => b.id) } } });
  await prisma.smsBroadcast.deleteMany({ where: { title: { startsWith: P } } });
  await prisma.smsOptOut.deleteMany({ where: { mobile: { in: MOBS } } });
}

function fd(o: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const edmForm = (tag: string, list: string, extra: Record<string, string> = {}) =>
  fd({ subject: SUB(tag), body: "您好 {name}，這是測試信。", mode: "send", audience: "manual", manualList: list, ...extra });

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  process.env.RESEND_BATCH_URL = `http://127.0.0.1:${port}`;
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "Test <test@example.com>";
  process.env.UNSUBSCRIBE_SECRET = "u".repeat(48);
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  delete process.env.MAACGO_API_KEY;
  delete process.env.SMS_PROVIDER;

  const { sendBroadcastAction, updateBroadcastAction, resendFailedBroadcastAction } = await import("../src/actions/admin");
  const { processDueBroadcasts } = await import("../src/lib/email/dispatch");
  const { sendSmsAction } = await import("../src/actions/sms");
  const { processDueSmsBroadcasts } = await import("../src/lib/sms/dispatch");
  await cleanup();

  // ═══ A ═══
  console.log("\nA. EDM 基準");
  {
    const r = await sendBroadcastAction(null, edmForm("A", `a1${D},小明\na2${D},小華\na3${D}`));
    check("手動名單 3 人寄出 → 成功", !!r && "success" in r && !!r.success, JSON.stringify(r));
    check("每人各收到 1 封", [1, 2, 3].every((i) => countTo(`a${i}${D}`, SUB("A")) === 1), JSON.stringify(mails.map((m) => m.to)));
    const b = await prisma.emailBroadcast.findFirst({ where: { subject: SUB("A") } });
    check("群發紀錄 SENT、sentCount=3", b?.status === "SENT" && b.sentCount === 3, JSON.stringify({ s: b?.status, c: b?.sentCount }));
  }

  // ═══ B ═══
  console.log("\nB. 名單清洗");
  {
    await sendBroadcastAction(null, edmForm("B", `Dup${D}, dup${D} ; DUP${D}\n  dup${D}  \nnot-an-email\n@@\n\n,,,\nother${D}`));
    check("同一信箱大小寫／空白／分隔符重複 5 次 → 只收到 1 封", countTo(`dup${D}`, SUB("B")) === 1, String(countTo(`dup${D}`, SUB("B"))));
    check("無效信箱（not-an-email、@@）不會被寄出", !mails.some((m) => m.subject === SUB("B") && !m.to.endsWith(D)), JSON.stringify(mails.filter((m) => m.subject === SUB("B")).map((m) => m.to)));
    check("正常的另一位也有收到", countTo(`other${D}`, SUB("B")) === 1);
  }

  // ═══ C ═══
  console.log("\nC. 連點「寄出」（同一份表單、同一個 requestKey 併發 3 次）");
  {
    const list = `c1${D}\nc2${D}\nc3${D}`;
    const key = crypto.randomUUID();
    await Promise.all([1, 2, 3].map(() => sendBroadcastAction(null, edmForm("C", list, { requestKey: key }))));
    const got = [1, 2, 3].map((i) => countTo(`c${i}${D}`, SUB("C")));
    check("每位收件人最多收到 1 封（連點、網路重送、兩個管理員同時按）", got.every((n) => n <= 1), `各收到 ${got.join("、")} 封；建立了 ${await prisma.emailBroadcast.count({ where: { subject: SUB("C") } })} 筆群發紀錄`);
    check("同一個 requestKey 事後再送一次 → 仍被擋，不重複寄", await (async () => {
      const r = await sendBroadcastAction(null, edmForm("C", list, { requestKey: key }));
      return !!r && "error" in r && /送出過/.test(r.error ?? "") && [1, 2, 3].every((i) => countTo(`c${i}${D}`, SUB("C")) <= 1);
    })());
    const legacy = [`l1${D}`, `l2${D}`];
    await sendBroadcastAction(null, edmForm("C2", legacy.join("\n")));
    await sendBroadcastAction(null, edmForm("C2", legacy.join("\n")));
    check("舊客戶端不帶 requestKey → 不被擋（兩次獨立送出各寄 1 封，共 2 封）", legacy.every((e) => countTo(e, SUB("C2")) === 2), legacy.map((e) => countTo(e, SUB("C2"))).join("、"));
    const otherKey = [`k1${D}`];
    await sendBroadcastAction(null, edmForm("C3", otherKey[0], { requestKey: crypto.randomUUID() }));
    await sendBroadcastAction(null, edmForm("C3", otherKey[0], { requestKey: crypto.randomUUID() }));
    check("不同的 requestKey（兩份獨立的表單）→ 各自寄出，不互相誤擋", countTo(otherKey[0], SUB("C3")) === 2);
  }

  // ═══ D ═══
  console.log("\nD. 草稿併發寄出、cron 重疊、補寄併發");
  {
    const draft = await prisma.emailBroadcast.create({
      data: { subject: SUB("D1"), body: "草稿內文", status: "DRAFT", audienceType: "MANUAL", manualRows: [{ email: `d1${D}` }, { email: `d2${D}` }] },
    });
    await Promise.all([1, 2, 3].map(() => updateBroadcastAction(draft.id, null, fd({ subject: SUB("D1"), body: "草稿內文 {name}", mode: "send", audience: "manual", manualList: `d1${D}\nd2${D}` }))));
    check("同一份草稿被 3 個人同時按『寄出』→ 原子認領，每人只收到 1 封", countTo(`d1${D}`, SUB("D1")) === 1 && countTo(`d2${D}`, SUB("D1")) === 1, `${countTo(`d1${D}`, SUB("D1"))}／${countTo(`d2${D}`, SUB("D1"))}`);

    await prisma.emailBroadcast.create({
      data: { subject: SUB("D2"), body: "排程內文", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), audienceType: "MANUAL", manualRows: [{ email: `s1${D}` }, { email: `s2${D}` }] },
    });
    await Promise.all([1, 2, 3].map(() => processDueBroadcasts()));
    check("cron 重疊執行 3 次 → 到期的排程只寄一次", countTo(`s1${D}`, SUB("D2")) === 1 && countTo(`s2${D}`, SUB("D2")) === 1, `${countTo(`s1${D}`, SUB("D2"))}／${countTo(`s2${D}`, SUB("D2"))}`);

    const orig = await prisma.emailBroadcast.create({
      data: { subject: SUB("D3"), body: "原信", status: "SENT", sentCount: 1, failedCount: 2, audienceType: "MANUAL", failedRecipients: [{ email: `f1${D}`, reason: "x" }, { email: `f2${D}`, reason: "x" }] },
    });
    await Promise.all([1, 2, 3].map(() => resendFailedBroadcastAction(null, fd({ broadcastId: orig.id }))));
    check("補寄失敗者被連點／併發 3 次 → 每位只補寄 1 封", countTo(`f1${D}`, SUB("D3")) <= 1 && countTo(`f2${D}`, SUB("D3")) <= 1, `${countTo(`f1${D}`, SUB("D3"))}／${countTo(`f2${D}`, SUB("D3"))}`);
  }

  // ═══ E ═══
  console.log("\nE. 退訂者與退訂標頭");
  {
    await prisma.mailUnsubscribe.create({ data: { email: `unsub${D}`, reason: "test" } });
    await sendBroadcastAction(null, edmForm("E", `unsub${D}\nkeep${D}`));
    check("行銷信：已退訂的人不寄", countTo(`unsub${D}`, SUB("E")) === 0);
    check("行銷信：沒退訂的照寄", countTo(`keep${D}`, SUB("E")) === 1);
    const m = mails.find((x) => x.to === `keep${D}` && x.subject === SUB("E"));
    check("信件帶 List-Unsubscribe 與 One-Click 標頭（Gmail／Yahoo 大量寄信規範）", !!m && /unsubscribe\?email=/.test(m.headers["List-Unsubscribe"] ?? "") && /One-Click/i.test(m.headers["List-Unsubscribe-Post"] ?? ""), JSON.stringify(m?.headers));
    check("內文頁尾有個人化退訂連結", !!m && /\/unsubscribe\?email=keep/.test(m.html.replace(/&amp;/g, "&").replace(/%40/g, "@")), (m?.html ?? "").slice(-200));
  }

  // ═══ F ═══
  console.log("\nF. 空名單與大名單");
  {
    const before = mails.length;
    const r1 = await sendBroadcastAction(null, edmForm("F1", ""));
    const r2 = await sendBroadcastAction(null, edmForm("F2", "x\ny\nz@\n@z"));
    check("空名單 → 錯誤、零寄出", !!r1 && "error" in r1 && mails.length === before);
    check("全是無效信箱 → 錯誤、零寄出", !!r2 && "error" in r2 && mails.length === before, JSON.stringify(r2));
    const big = Array.from({ length: 1200 }, (_, i) => `big${i}${D}`).join("\n");
    const t0 = Date.now();
    const r3 = await sendBroadcastAction(null, edmForm("F3", big));
    const got = mails.filter((m) => m.subject === SUB("F3"));
    const per = new Map<string, number>();
    for (const m of got) per.set(m.to, (per.get(m.to) ?? 0) + 1);
    check("1,200 人名單全部寄達", per.size === 1200, `寄達 ${per.size} 人；回應 ${JSON.stringify(r3).slice(0, 100)}`);
    check("沒有任何人收到重複信件", [...per.values()].every((n) => n === 1), `重複 ${[...per.values()].filter((n) => n > 1).length} 人`);
    check("1,200 人在 60 秒內寄完", Date.now() - t0 < 60_000, `${Date.now() - t0}ms`);
  }

  // ═══ G ═══
  console.log("\nG. 合併欄位含 HTML／腳本");
  {
    const evil = [`<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">點我</a>`];
    const list = evil.map((n, i) => `g${i}${D},${n.replace(/,/g, "")}`).join("\n");
    await sendBroadcastAction(null, fd({ subject: SUB("G"), body: "您好 {name}，歡迎。", mode: "send", audience: "manual", manualList: list }));
    const html = mails.filter((m) => m.subject === SUB("G")).map((m) => m.html).join("\n");
    check("寄出的信件中，收件人姓名裡的 <script> 沒有原樣進入 HTML", mails.some((m) => m.subject === SUB("G")) && !/<script>alert\(1\)<\/script>/i.test(html), "原樣出現在信件 HTML");
    check("姓名裡的 onerror／javascript: 屬性沒有以可執行形式進入 HTML", !/<img[^>]+onerror=/i.test(html) && !/href="javascript:/i.test(html), "可執行形式出現在信件 HTML");
  }

  // ═══ H ═══
  console.log("\nH. 退訂端點 /api/unsubscribe");
  {
    const { POST } = await import("../src/app/api/unsubscribe/route");
    const { NextRequest } = await import("next/server");
    const { unsubscribeToken } = await import("../src/lib/email/unsubscribe");
    const call = async (email: string, token: string) => {
      try {
        const res = await POST(new NextRequest(`http://localhost/api/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`, { method: "POST" }));
        return res.status;
      } catch {
        return -1;
      }
    };
    const tok = unsubscribeToken(`h1${D}`)!;
    check("正確的 token → 200，並寫入退訂名單", (await call(`h1${D}`, tok)) === 200 && !!(await prisma.mailUnsubscribe.findUnique({ where: { email: `h1${D}` } })));
    check("重放同一個連結 → 仍是 200 且只有 1 筆（冪等）", (await call(`h1${D}`, tok)) === 200 && (await prisma.mailUnsubscribe.count({ where: { email: `h1${D}` } })) === 1);
    check("大小寫與前後空白不同的同一信箱 → 同一個 token 有效，寫入的是正規化後的信箱", (await call(` H2${D.toUpperCase()} `, unsubscribeToken(`h2${D}`)!)) === 200 && !!(await prisma.mailUnsubscribe.findUnique({ where: { email: `h2${D}` } })));
    check("A 的 token 不能退訂 B → 400 且 B 沒被退訂", (await call(`h3${D}`, tok)) === 400 && !(await prisma.mailUnsubscribe.findUnique({ where: { email: `h3${D}` } })));
    for (const [label, t] of [["空 token", ""], ["非 hex 字元", "zz".repeat(32)], ["長度不足", "ab"], ["超長 token", "a".repeat(100_000)], ["全 0", "0".repeat(64)]] as const) {
      check(`${label} → 400，不 throw`, (await call(`h4${D}`, t)) === 400);
    }
    check("超長信箱參數（10 萬字元）＋偽造 token → 400，不 throw", (await call("x".repeat(100_000) + D, tok)) === 400);
    check("沒有任何一個偽造請求寫入退訂名單", (await prisma.mailUnsubscribe.count({ where: { email: { in: [`h3${D}`, `h4${D}`] } } })) === 0);
    const saved = process.env.UNSUBSCRIBE_SECRET;
    delete process.env.UNSUBSCRIBE_SECRET;
    console.error = () => undefined;
    check("未設定 UNSUBSCRIBE_SECRET → 所有請求一律拒絕（不會用空 secret 驗證通過）", (await call(`h5${D}`, tok)) === 400 && (await call(`h5${D}`, "")) === 400);
    console.error = quiet;
    process.env.UNSUBSCRIBE_SECRET = saved;
  }

  // ═══ 簡訊 ═══
  const sms = (tag: string, list: string, extra: Record<string, string> = {}) =>
    fd({ title: SUB(tag), body: "測試簡訊內容", mode: "send", messageType: "NOTICE", noticeAck: "on", audience: "manual", manualList: list, ...extra });
  const smsCount = async (mobile: string, tag?: string) =>
    prisma.smsMessage.count({ where: { mobile, ...(tag ? { broadcast: { title: SUB(tag) } } : {}) } });
  const mob = (n: number) => `0912000${String(n).padStart(3, "0")}`;

  console.log("\nN. 簡訊基準");
  {
    const r = await sendSmsAction(null, sms("N", `${mob(1)},小明\n${mob(2)},小華`));
    check("手動名單 2 人發送（測試模式）→ 成功", !!r && "success" in r && !!r.success, JSON.stringify(r));
    check("每人 1 則", (await smsCount(mob(1), "N")) === 1 && (await smsCount(mob(2), "N")) === 1);
  }
  console.log("\nO. 號碼格式去重");
  {
    await sendSmsAction(null, sms("O", `0912-000-003, +886912000003\n912000003\n0912 000 003\n${mob(3)}`));
    check("同一支手機的 5 種寫法 → 只發 1 則", (await smsCount(mob(3), "O")) === 1, String(await smsCount(mob(3), "O")));
  }
  console.log("\nP. 無效與海外號碼");
  {
    let r: unknown;
    try { r = await sendSmsAction(null, sms("P", `12345\nabc\n0812345678\n+60123456789\n${mob(4)}\n09${"9".repeat(20)}`)); } catch (e) { r = { threw: String(e).slice(0, 60) }; }
    const total = await prisma.smsMessage.count({ where: { broadcast: { title: SUB("P") } } });
    check("混著無效、市話、海外號碼的名單 → 不 throw", !(r && typeof r === "object" && "threw" in (r as object)), JSON.stringify(r));
    check("只有合法的國內手機被發送（共 1 則）", total === 1 && (await smsCount(mob(4), "P")) === 1, `實際 ${total} 則`);
  }
  console.log("\nQ. 連點「發送」（同一份表單、同一個 requestKey 併發 3 次）");
  {
    const key = crypto.randomUUID();
    await Promise.all([1, 2, 3].map(() => sendSmsAction(null, sms("Q", `${mob(5)}\n${mob(6)}`, { requestKey: key }))));
    const got = [await smsCount(mob(5), "Q"), await smsCount(mob(6), "Q")];
    check("每支手機最多收到 1 則（簡訊重複發送要付兩次錢）", got.every((n) => n <= 1), `各收到 ${got.join("、")} 則；建立了 ${await prisma.smsBroadcast.count({ where: { title: SUB("Q") } })} 筆發送紀錄`);
    const r = await sendSmsAction(null, sms("Q", `${mob(5)}\n${mob(6)}`, { requestKey: key }));
    check("同一個 requestKey 事後再送一次 → 仍被擋，不重複發", !!r && "error" in r && /送出過/.test(r.error ?? "") && (await smsCount(mob(5), "Q")) <= 1);
    await sendSmsAction(null, sms("Q2", mob(14)));
    await sendSmsAction(null, sms("Q2", mob(14)));
    check("舊客戶端不帶 requestKey → 不被擋（兩次獨立送出各發 1 則）", (await smsCount(mob(14), "Q2")) === 2, String(await smsCount(mob(14), "Q2")));
  }
  console.log("\nR. 退訂名單");
  {
    await prisma.smsOptOut.create({ data: { mobile: mob(7), reason: "test" } });
    await sendSmsAction(null, sms("R", `${mob(7)}\n${mob(8)}`, { messageType: "MARKETING" }));
    check("行銷簡訊：退訂者不發、其他人照發", (await smsCount(mob(7), "R")) === 0 && (await smsCount(mob(8), "R")) === 1, `${await smsCount(mob(7), "R")}／${await smsCount(mob(8), "R")}`);
  }
  console.log("\nS. 超長內文的成本");
  {
    const r = await sendSmsAction(null, sms("S", mob(9), { body: "字".repeat(5000) }));
    const b = await prisma.smsBroadcast.findFirst({ where: { title: SUB("S") } });
    check("5,000 字的簡訊要被拒絕，或則數有合理上限（≤ 10 則／人）；否則一次誤貼就可能產生巨額簡訊費", (!!r && "error" in r) || (b?.actualSegments ?? 0) <= 10,
      `實際記錄 ${b?.actualSegments ?? "?"} 則（預估單價 ${b?.unitPriceCents ?? "?"} 分/則）`);
  }
  console.log("\nT. 必填檢查");
  {
    const before = await prisma.smsBroadcast.count({ where: { title: { startsWith: `${P}T` } } });
    const rs = await Promise.all([
      sendSmsAction(null, sms("T1", mob(10), { body: "" })),
      sendSmsAction(null, sms("T2", mob(10), { body: "含 emoji 😀" })),
      sendSmsAction(null, fd({ title: SUB("T3"), body: "x", mode: "send", messageType: "NOTICE", audience: "manual", manualList: mob(10) })),
      sendSmsAction(null, sms("T4", "")),
    ]);
    check("空內文、emoji、未勾履約通知確認、空名單 → 全部拒絕且零發送", rs.every((r) => !!r && "error" in r) && (await prisma.smsMessage.count({ where: { mobile: mob(10) } })) === 0, JSON.stringify(rs.map((r) => (r && "error" in r ? r.error : "OK"))));
    void before;
  }
  console.log("\nU. 排程到期併發");
  {
    const due = await prisma.smsBroadcast.create({
      data: { title: SUB("U"), body: "排程簡訊", messageType: "NOTICE", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), audienceType: "MANUAL", manualRows: [{ mobile: mob(11), name: "排程" }] },
    });
    await Promise.all([1, 2, 3].map(() => processDueSmsBroadcasts().catch(() => undefined)));
    check("cron 重疊執行 3 次 → 到期的排程簡訊只發一次", (await smsCount(mob(11), "U")) === 1, String(await smsCount(mob(11), "U")));
    void due;
    const r = await sendSmsAction(null, sms("U2", mob(12), { scheduledAt: "2020-01-01T10:00" }));
    check("排程時間在過去 → 拒絕", !!r && "error" in r);
  }
  console.log("\nV. 同一草稿併發送出");
  {
    const draft = await prisma.smsBroadcast.create({ data: { title: SUB("V"), body: "草稿簡訊", messageType: "NOTICE", status: "DRAFT", audienceType: "MANUAL", manualRows: [{ mobile: mob(13), name: "草稿" }] } });
    await Promise.all([1, 2, 3].map(() => sendSmsAction(null, sms("V", mob(13), { draftId: draft.id }))));
    check("同一份草稿 3 個人同時按『發送』→ 樂觀鎖，只發 1 則", (await smsCount(mob(13), "V")) === 1, String(await smsCount(mob(13), "V")));
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
