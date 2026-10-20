/* 五種財富自我檢測：收名單 API（POST /api/check/wealth5）端到端（會寫入資料庫，**只能對本機 localhost 跑**）。
 *
 * Resend 用本機 HTTP mock（不寄真信）；Supabase 不會被碰到（這條路徑只走 prisma）。
 * 守的事：合法送出 → WebinarRequest 一筆＋答案快照伺服器重算＋三個名單群組＋學員記錄卡＋寄信狀態 SENT；
 *         蜜罐 → 假成功、進 WebinarBlockedAttempt、不進名單；驗證失敗 400；檢測關閉 503；
 *         同信箱 60 秒內重送只更新不重寄；寄信失敗仍 200 且標 FAILED（名單不丟）；限流 429。
 * 跑法：RESEND_API_KEY= MAACGO_API_KEY= SUPABASE_SECRET_KEY= npx tsx --conditions=react-server scripts/test-wealth5-lead-db.ts
 * 測完會刪掉自己建的資料。 */
import { createServer } from "node:http";
import { once } from "node:events";
import { NextRequest } from "next/server";
// Prisma Client 載入時讀 .env：先 import 才看得到 DATABASE_URL 做本機守門（與其他 *-db.ts 一致）
import { prisma } from "../src/lib/db";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("✗ DATABASE_URL 不是本機資料庫，拒絕執行（此測試會寫入）");
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ""}`); }
}

// ── Resend mock：主旨含 "FAILSEND" 時回 500，其餘成功 ──
const sentMails: { to: string; subject: string; html: string }[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const messages = JSON.parse(raw) as { to: string[]; subject: string; html: string }[];
    // 只記錄「寄成功」的：失敗情境會重試三次，記下來會把次數算錯
    if (process.env.W5C_TEST_FAIL_SEND === "1") { res.writeHead(500); res.end("down"); return; }
    for (const m of messages) sentMails.push({ to: m.to[0], subject: m.subject, html: m.html });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: messages.map((_, i) => ({ id: `m-${i}` })) }));
  });
});

const SUFFIX = "@w5c.test";
const answers: Record<string, number> = {};
for (const id of ["A1", "A2", "A3", "A4", "A5"]) answers[id] = 3;
answers.A2 = 1; // 最弱財富
for (const d of ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]) { answers[`${d}a`] = 3; answers[`${d}b`] = 3; }
answers.D4a = 1; answers.D4b = 1; // 根源精神（避開 A2×D2 特例）

function post(body: unknown) {
  return new NextRequest("http://localhost/api/check/wealth5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock 無 port");
  process.env.RESEND_BATCH_URL = `http://127.0.0.1:${address.port}`;
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "Test <test@example.com>";
  process.env.NEXT_PUBLIC_BASE_URL = "https://course.huangxi.info";

  // env 設好之後才能載入（broadcast 模組載入時固定 URL）
  const { POST } = await import("../src/app/api/check/wealth5/route");
  const { WEALTH5_CHECK_SLUG, WEALTH5_GROUP_NAMES } = await import("../src/lib/wealth5-check");

  async function cleanup() {
    const w = await prisma.webinar.findUnique({ where: { slug: WEALTH5_CHECK_SLUG }, select: { id: true } });
    if (w) {
      await prisma.webinarRequest.deleteMany({ where: { webinarId: w.id } });
      await prisma.webinarBlockedAttempt.deleteMany({ where: { webinarId: w.id } });
      await prisma.studentEngagement.deleteMany({ where: { sourceRef: w.id } });
      await prisma.webinar.delete({ where: { id: w.id } });
    }
    await prisma.mailGroupMember.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.mailGroup.deleteMany({ where: { name: { in: Object.values(WEALTH5_GROUP_NAMES) } } });
    await prisma.studentRecord.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.boardLoginThrottle.deleteMany({ where: { key: { startsWith: "form:wealth5-check:" } } });
  }
  await cleanup();

  console.log("\n檢測尚未建立／關閉");
  {
    const res = await POST(post({ name: "甲", email: `a${SUFFIX}`, answers }));
    check("Webinar 不存在 → 503", res.status === 503);
  }
  const webinar = await prisma.webinar.create({
    data: {
      slug: WEALTH5_CHECK_SLUG, title: "五種財富自我檢測（測試）", description: "x", kind: "RESOURCE",
      lectureUrl: "https://www.seehope66.com/svipyx", emailSubject: "x", emailBody: "x", isActive: false,
    },
  });
  {
    const res = await POST(post({ name: "甲", email: `a${SUFFIX}`, answers }));
    check("isActive=false → 503", res.status === 503);
    await prisma.webinar.update({ where: { id: webinar.id }, data: { isActive: true } });
  }

  console.log("\n輸入驗證");
  {
    check("非 JSON → 400", (await POST(post("{bad"))).status === 400);
    check("缺 Email → 400", (await POST(post({ name: "甲", answers }))).status === 400);
    check("少一題 → 400", (await POST(post({ name: "甲", email: `a${SUFFIX}`, answers: { ...answers, D7b: undefined } }))).status === 400);
    check("作答 7 → 400", (await POST(post({ name: "甲", email: `a${SUFFIX}`, answers: { ...answers, A1: 7 } }))).status === 400);
    check("驗證失敗不留名單", (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 0);
  }

  console.log("\n蜜罐");
  {
    const res = await POST(post({ name: "bot", email: `bot${SUFFIX}`, answers, hp_extra_note: "http://spam" }));
    check("蜜罐觸發回 200 假成功", res.status === 200);
    const blocked = await prisma.webinarBlockedAttempt.findFirst({ where: { webinarId: webinar.id, email: `bot${SUFFIX}` } });
    check("留痕進 WebinarBlockedAttempt（HONEYPOT）", blocked?.reason === "HONEYPOT");
    check("不進正式名單", (await prisma.webinarRequest.count({ where: { webinarId: webinar.id, email: `bot${SUFFIX}` } })) === 0);
    check("不寄信", sentMails.length === 0);
    check("空白蜜罐不算觸發（留給下一段驗證）", true);
  }

  console.log("\n合法送出：名單／快照／群組／記錄卡／報告信");
  const email = `ming${SUFFIX}`;
  {
    const res = await POST(post({
      name: "王小明", email: "Ming@W5C.test", phone: "0912-345-678", lineId: "ming_line", topConcern: "錢留不住",
      source: "fb", answers, hp_extra_note: "   ", result: { totalScore: 100, weakestArea: "A5" }, // 前端 result 必須被忽略
    }));
    check("回 200 ok", res.status === 200 && (await res.json()).ok === true);
    const row = await prisma.webinarRequest.findUnique({ where: { webinarId_email: { webinarId: webinar.id, email } } });
    check("WebinarRequest 一筆、Email 小寫正規化", !!row);
    check("手機正規化 0912345678", row?.phone === "0912345678");
    const snap = (row?.answers ?? []) as { questionId: string; label: string; value: string[] }[];
    const by = (l: string) => snap.find((s) => s.label === l)?.value[0] ?? "";
    check("快照總分由伺服器重算（40，不是前端的 100）", by("五力總分") === "40", by("五力總分"));
    check("快照最弱領域 財富（不是前端竄改的 A5）", by("最弱領域").startsWith("財富"), by("最弱領域"));
    check("快照根源 精神", by("根源維度") === "精神", by("根源維度"));
    check("快照分數帶 培育", by("分數帶").startsWith("培育"), by("分數帶"));
    check("快照含 LINE／備註／來源", by("LINE ID") === "ming_line" && by("最想處理的事") === "錢留不住" && by("來源") === "fb");
    check("寄送狀態 SENT、sentCount=1", row?.deliveryStatus === "SENT" && row?.sentCount === 1 && !!row?.lastSentAt);

    check("報告信寄到該信箱一封", sentMails.length === 1 && sentMails[0].to === email, JSON.stringify(sentMails.map((m) => m.to)));
    const mail = sentMails[0];
    check("主旨含最弱領域與根源", mail?.subject.includes("財富") && mail?.subject.includes("精神"));
    check("信內含 90 天行動與 CTA 按鈕", mail?.html.includes("90 天") && mail?.html.includes("seehope66.com/svipyx") && mail?.html.includes("/webinar/book-club"));
    check("信內無療效字眼", !/慢性病|治療|療效|預防疾病/.test(mail?.html ?? ""));

    const groups = await prisma.mailGroup.findMany({ where: { name: { in: Object.values(WEALTH5_GROUP_NAMES) } }, include: { members: true } });
    const named = (n: string) => groups.find((g) => g.name === n);
    check("建立「全部索取者」群組並加入", named(WEALTH5_GROUP_NAMES.all)?.members.some((m) => m.email === email) === true);
    check("建立「培育」群組並加入", named(WEALTH5_GROUP_NAMES.nurture)?.members.some((m) => m.email === email) === true);
    check("沒有進「轉換」群組", !named(WEALTH5_GROUP_NAMES.convert)?.members.some((m) => m.email === email));

    const student = await prisma.studentRecord.findUnique({ where: { phone: "0912345678" } });
    check("學員記錄卡建立（手機為鍵）", !!student && student.email === email);
    const eng = await prisma.studentEngagement.findFirst({ where: { sourceRef: webinar.id } });
    check("接觸紀錄 LEAD_CAPTURE／OTHER（不計上課史）", eng?.source === "LEAD_CAPTURE" && eng?.type === "OTHER");
  }

  console.log("\n同信箱 60 秒內重送");
  {
    // 同名重送（姓名改了會依同行者鐵則視為另一個人、另開記錄卡——那是 upsertStudent 的既定規則，不在這裡測）
    const res = await POST(post({ name: "王小明", email, answers: { ...answers, A2: 5, A4: 1 } }));
    check("回 200", res.status === 200);
    const row = await prisma.webinarRequest.findUnique({ where: { webinarId_email: { webinarId: webinar.id, email } } });
    const snap = (row?.answers ?? []) as { label: string; value: string[] }[];
    check("名單只有一筆、以最新作答為準（最弱變家庭）", (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 1 && snap.find((s) => s.label === "最弱領域")?.value[0].startsWith("家庭") === true);
    check("手機沒填 → 留舊值", row?.phone === "0912345678");
    check("冷卻內不重寄（仍 1 封）、sentCount 不變", sentMails.length === 1 && row?.sentCount === 1);
    check("接觸紀錄不重複", (await prisma.studentEngagement.count({ where: { sourceRef: webinar.id } })) === 1);
  }

  console.log("\n寄信失敗：名單仍存、回 200、標 FAILED");
  {
    process.env.W5C_TEST_FAIL_SEND = "1";
    const email2 = `fail${SUFFIX}`;
    const res = await POST(post({ name: "乙", email: email2, answers: { ...answers, A1: 5, A2: 5, A3: 5, A4: 5, A5: 4 } }));
    process.env.W5C_TEST_FAIL_SEND = "";
    check("回 200（不擋使用者看報告）", res.status === 200);
    const row = await prisma.webinarRequest.findUnique({ where: { webinarId_email: { webinarId: webinar.id, email: email2 } } });
    check("名單存在且 deliveryStatus=FAILED、sentCount=0", row?.deliveryStatus === "FAILED" && row?.sentCount === 0 && !row?.lastSentAt);
    check("無手機也能進名單與記錄卡（信箱路徑）", row?.phone === null && !!(await prisma.studentRecord.findFirst({ where: { email: email2 } })));
    const convert = await prisma.mailGroup.findUnique({ where: { name: WEALTH5_GROUP_NAMES.convert }, include: { members: true } });
    check("高分者進「轉換」群組", convert?.members.some((m) => m.email === email2) === true);
    const retry = await POST(post({ name: "乙", email: email2, answers: { ...answers, A1: 5, A2: 5, A3: 5, A4: 5, A5: 4 } }));
    check("FAILED 後立即重送 → 重新寄（lastSentAt 為空不受冷卻）", retry.status === 200 && sentMails.filter((m) => m.to === email2).length === 1);
  }

  console.log("\n限流（同 IP 10 分鐘 20 次）");
  {
    let blocked = 0;
    for (let i = 0; i < 20; i++) {
      const res = await POST(post({ name: "丙", email: `rl${i}${SUFFIX}`, answers }));
      if (res.status === 429) blocked++;
    }
    check("前面已用掉 4 次，再送 20 次中有 429 出現", blocked >= 1, `blocked=${blocked}`);
    check("被 429 擋下的不進名單", (await prisma.webinarRequest.count({ where: { webinarId: webinar.id } })) === 2 + (20 - blocked));
  }

  await cleanup();
  server.close();
  console.log(`\n${fail === 0 ? "全部通過" : "有失敗"}（${pass} 項）${fail ? `，失敗 ${fail}` : ""}`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
