/* 五種財富自我檢測（/check/wealth5）離線契約。純離線：讀原始碼、跑純函式、用 vm 跑檢測頁的 JS。
 *
 * 守的事：
 * 1. 計分：規格 11.1 的 T1–T6 ＋ 伺服器 TS 實作與檢測頁 JS 實作隨機 300 組作答必須逐項一致
 *    （兩份實作，任何一邊改了另一邊沒跟上就紅）。
 * 2. 檢測頁：零外部 script／stylesheet（平台 CSP）、內容由注入（HTML 內不得再有題庫）、
 *    Email 必填、蜜罐欄位、無療效宣稱字眼、免責聲明。
 * 3. 名單驗證：19 題缺一不可、只收 1–5 整數、欄位上限。
 * 4. 報告信：內容只來自內容表；分數帶決定 CTA 順序；空連結不產生按鈕；健康領域附醫療免責。
 * 5. 路由：API 蜜罐先於驗證、限流、分數伺服器重算、寄信帶 webinarId；GET 檢查分頁開關、JSON 逸出。
 * 跑法：npx tsx scripts/test-wealth5-check.ts */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  WEALTH5_ANSWER_KEYS,
  WEALTH5_DEFAULT_LINKS,
  buildWealth5Answers,
  buildWealth5ReportMail,
  computeWealth5,
  parseWealth5Lead,
  type Wealth5Answers,
  type Wealth5Result,
} from "../src/lib/wealth5-check";
import { WEALTH5_CONTENT } from "../src/lib/wealth5-content";

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
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const HTML = read("src/content/wealth5-check.html");
const API = read("src/app/api/check/wealth5/route.ts");
const PAGE = read("src/app/check/wealth5/route.ts");
const LIB = read("src/lib/wealth5-check.ts");
const SITE_PAGES = read("src/lib/site-pages.ts");
const NEXT_CONFIG = read("next.config.ts");
const WEBINAR_PAGE = read("src/app/webinar/[slug]/page.tsx");

/** 規格 11.1 的輸入寫法：A=[a1..a5]，D 可整體給值或逐維度給 [a,b] */
function answersOf(A: number[], D: number | Record<string, [number, number]>): Wealth5Answers {
  const out: Wealth5Answers = {};
  ["A1", "A2", "A3", "A4", "A5"].forEach((id, i) => (out[id] = A[i]));
  for (const d of ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]) {
    const pair = typeof D === "number" ? [D, D] : (D[d] ?? [3, 3]);
    out[`${d}a`] = pair[0];
    out[`${d}b`] = pair[1];
  }
  return out;
}

console.log("\n計分：規格 11.1 測試案例");
{
  const t1 = computeWealth5(answersOf([3, 1, 4, 3, 4], 3));
  check("T1 最弱領域 A2", t1.weakestArea === "A2");
  check("T1 七維度全 50", Object.values(t1.dimScores).every((v) => v === 50));
  check("T1 根源 D2（第 1 優先扣 12 後最低）", t1.rootDim === "D2");
  check("T1 ctaBand nurture", t1.ctaBand === "nurture");

  const t2 = computeWealth5(answersOf([2, 2, 5, 5, 5], { D1: [1, 1], D5: [5, 5] }));
  // A1、A2 同為 25；A1 相關維度平均 (D5 100,D1 0,D4 50,D3 50,D7 50)=50；A2 (D2 50,D4 50,D5 100,D1 0,D7 50)=50 → 固定順序取 A2
  check("T2 同分決勝唯一且不當機（A2）", t2.weakestArea === "A2" && !!t2.rootDim && !!t2.secondDim);
  check("T2 根源 D1（情緒 0 分，扣 3 後 -3 最低）", t2.rootDim === "D1");

  const t3 = computeWealth5(answersOf([1, 1, 1, 1, 1], 1));
  check("T3 總分 0、all_low、nurture", t3.totalScore === 0 && t3.profile === "all_low" && t3.ctaBand === "nurture");

  const t4 = computeWealth5(answersOf([5, 5, 5, 5, 5], 5));
  check("T4 總分 100、balanced_high、仍有 weakestArea（固定順序 A2）", t4.totalScore === 100 && t4.profile === "balanced_high" && t4.weakestArea === "A2");

  const t5 = computeWealth5(answersOf([4, 1, 4, 4, 4], { D2: [1, 1], D1: [5, 5], D3: [5, 5], D4: [5, 5], D5: [5, 5], D6: [5, 5], D7: [5, 5] }));
  check("T5 A2×D2 同名特例", t5.weakestArea === "A2" && t5.rootDim === "D2");

  const t6 = computeWealth5(answersOf([4, 4, 1, 4, 4], { D3: [1, 1], D1: [5, 5], D2: [5, 5], D4: [5, 5], D5: [5, 5], D6: [5, 5], D7: [5, 5] }));
  check("T6 A3×D3 同名特例", t6.weakestArea === "A3" && t6.rootDim === "D3");
}

console.log("\n計分：伺服器 TS 與檢測頁 JS 兩份實作逐項一致");
{
  // 在 vm 跑檢測頁的 <script>，只為了取得 window.Wealth5Test.calculate；DOM 用最小替身
  const script = HTML.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1] ?? "";
  check("檢測頁有主 script", script.length > 1000);
  const el = () => ({
    innerHTML: "",
    content: "",
    style: { setProperty: () => {} },
    hidden: false,
    tabIndex: 0,
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeAttribute: () => {},
    setAttribute: () => {},
    scrollIntoView: () => {},
    focus: () => {},
  });
  const storage = new Map<string, string>();
  const ctx: Record<string, unknown> = {
    console,
    setTimeout: (fn: () => void) => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
    location: { search: "", reload: () => {} },
    navigator: {},
    document: {
      title: "",
      documentElement: { style: { setProperty: () => {} } },
      getElementById: () => el(),
      querySelector: () => el(),
      querySelectorAll: () => [],
      createElement: () => el(),
      addEventListener: () => {},
      body: el(),
    },
    URLSearchParams,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    Promise,
    Error,
    isSecureContext: false,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    confirm: () => false,
    AbortController,
    fetch: async () => ({ ok: true }),
    Blob: class {},
    URL,
    Image: class {},
  };
  ctx.window = ctx;
  (ctx as { window: Record<string, unknown> }).window.__W5C_CONTENT__ = { ...WEALTH5_CONTENT, links: WEALTH5_DEFAULT_LINKS };
  let calcJs: ((a: Wealth5Answers) => Wealth5Result) | null = null;
  try {
    vm.createContext(ctx);
    vm.runInContext(script, ctx);
    const api = (ctx as { Wealth5Test?: { calculate: (a: Wealth5Answers) => Wealth5Result } }).Wealth5Test;
    calcJs = api?.calculate ?? null;
  } catch (e) {
    check("檢測頁 script 可在 vm 載入", false, String(e));
  }
  check("取得 window.Wealth5Test.calculate", typeof calcJs === "function");
  if (calcJs) {
    // 固定種子的簡單 LCG，讓失敗可重現
    let seed = 20261020;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let mismatch = "";
    const extremes = [1, 5];
    for (let i = 0; i < 300 && !mismatch; i++) {
      const a: Wealth5Answers = {};
      for (const k of WEALTH5_ANSWER_KEYS) a[k] = i < 40 ? extremes[Math.floor(rnd() * 2)] : 1 + Math.floor(rnd() * 5);
      const ts = computeWealth5(a);
      const js = calcJs(a);
      if (JSON.stringify(ts) !== JSON.stringify(js)) mismatch = `第 ${i} 組 ${JSON.stringify(a)}\n    TS=${JSON.stringify(ts)}\n    JS=${JSON.stringify(js)}`;
    }
    check("隨機 300 組作答（含 40 組極值）兩邊結果逐項一致", !mismatch, mismatch);
  }
}

console.log("\n檢測頁 HTML 契約");
{
  check("沒有外部 script src", !/<script[^>]*\ssrc=/.test(HTML));
  check("沒有外部 stylesheet（Google Fonts 已移除，平台 CSP 不放行）", !/<link[^>]*rel="stylesheet"/.test(HTML) && !/fonts\.googleapis/.test(HTML));
  check("有注入點 <!--W5C_INJECT--> 在 </head> 之前", HTML.indexOf("<!--W5C_INJECT-->") > 0 && HTML.indexOf("<!--W5C_INJECT-->") < HTML.indexOf("</head>"));
  check("CONFIG 以 window.__W5C_CONTENT__ 注入內容", /\.\.\.\(window\.__W5C_CONTENT__\|\|\{\}\)/.test(HTML));
  check("HTML 內不再有題庫（questions: [）", !/^\s*questions:\s*\[/m.test(HTML));
  check("HTML 內不再有矩陣（matrix: {）", !/^\s*matrix:\s*\{/m.test(HTML));
  check("endpoint 指向站內 API", /endpoint: "\/api\/check\/wealth5"/.test(HTML));
  const form = HTML.slice(HTML.indexOf("function renderForm("), HTML.indexOf("function renderFullReport("));
  check("表單：Email 欄位 type=email、name=email", /name="email" type="email"/.test(form));
  check("表單：沒有 LINE／Email 二選一（contactType 已移除）", !/contactType/.test(form));
  check("表單：手機與 LINE ID 為選填欄位", /name="phone" type="tel"/.test(form) && /name="lineId"/.test(form));
  check("表單：蜜罐欄位 hp_extra_note、readonly、tabindex=-1", /name="hp_extra_note"[^>]*tabindex="-1"[^>]*readonly/.test(form));
  const validate = HTML.slice(HTML.indexOf("function validate("), HTML.indexOf("function timestamp("));
  check("前端驗證：Email 必填格式", /errors\.email=CONFIG\.ui\.errors\.email/.test(validate) && /@/.test(validate));
  check("前端驗證：手機留空不報錯", /values\.phone&&!/.test(validate));
  const submit = HTML.slice(HTML.indexOf("async function submitLead("), HTML.indexOf("async function retryLead("));
  check("送出帶原始作答 answers（伺服器重算）", /answers:state\.answers/.test(submit));
  check("送出成功才打 Lead 事件", /if\(success\)\{[^}]*track\("Lead"/.test(submit));
  check("送出失敗仍展開完整報告（fullUnlocked=true 不受 success 影響）", /state\.fullUnlocked=true/.test(submit));
  const banned = ["慢性病", "治療", "療效", "預防疾病"].filter((w) => HTML.includes(w) || JSON.stringify(WEALTH5_CONTENT).includes(w) || LIB.includes(w));
  check("全頁與內容表無療效宣稱字眼", banned.length === 0, banned.join("、"));
  check("免責聲明在內容中（封面與結果頁共用 CONFIG.meta.disclaimer）", /非心理測驗、非醫療診斷/.test(HTML) && /CONFIG\.meta\.disclaimer/.test(HTML));
  check("結果頁最弱為健康時顯示醫療免責", /a\.id==="A3"\?`<p class="health-note">/.test(HTML));
  check("restart 的 confirm 仍在（規格要求），其他地方沒有 alert", !/alert\(/.test(HTML));
}

console.log("\n名單驗證 parseWealth5Lead");
{
  const good = { name: "王小明", email: "Ming@Example.com ", phone: "0912 345 678", lineId: "ming", topConcern: "錢", source: "fb", answers: answersOf([3, 1, 4, 3, 4], 3) };
  const r = parseWealth5Lead(good);
  check("合法輸入通過且 Email 小寫去空白", r.ok && r.lead.email === "ming@example.com");
  check("19 題原封不動", r.ok && Object.keys(r.lead.answers).length === 19);
  check("缺 Email 擋下", !parseWealth5Lead({ ...good, email: "" }).ok);
  check("Email 格式錯擋下", !parseWealth5Lead({ ...good, email: "abc" }).ok);
  check("姓名空白擋下", !parseWealth5Lead({ ...good, name: "  " }).ok);
  check("姓名 >50 字擋下", !parseWealth5Lead({ ...good, name: "王".repeat(51) }).ok);
  check("少一題擋下", !parseWealth5Lead({ ...good, answers: (({ D7b: _omit, ...rest }) => rest)(good.answers) }).ok);
  check("作答 0 擋下", !parseWealth5Lead({ ...good, answers: { ...good.answers, A1: 0 } }).ok);
  check("作答 6 擋下", !parseWealth5Lead({ ...good, answers: { ...good.answers, A1: 6 } }).ok);
  check("作答非整數擋下", !parseWealth5Lead({ ...good, answers: { ...good.answers, A1: 2.5 } }).ok);
  check("作答字串擋下", !parseWealth5Lead({ ...good, answers: { ...good.answers, A1: "3" } }).ok);
  check("多餘的 key 不影響（只取 19 題）", parseWealth5Lead({ ...good, answers: { ...good.answers, __proto__x: 1, extra: 9 } }).ok);
  check("LINE ID >50 擋下", !parseWealth5Lead({ ...good, lineId: "x".repeat(51) }).ok);
  check("備註 >100 擋下", !parseWealth5Lead({ ...good, topConcern: "x".repeat(101) }).ok);
  check("姓名含控制字元擋下", !parseWealth5Lead({ ...good, name: "王\u0000明" }).ok);
  const noSrc = parseWealth5Lead({ ...good, source: "" });
  check("source 空 → direct", noSrc.ok && noSrc.lead.source === "direct");
  check("非物件輸入擋下不當機", !parseWealth5Lead(null).ok && !parseWealth5Lead([]).ok && !parseWealth5Lead("x").ok);
  check("前端送來的 result 被忽略（lead 型別沒有這欄）", r.ok && !("result" in r.lead));
}

console.log("\n答案快照與報告信");
{
  // A2 最弱、D4 根源（避開 A2×D2 特例，特例另測）：D2 高分、D4 低分
  const lead = parseWealth5Lead({ name: "王小明", email: "a@b.co", lineId: "ming", topConcern: "錢", source: "fb", answers: answersOf([3, 1, 4, 3, 4], { D2: [5, 5], D4: [1, 1] }) });
  if (!lead.ok) throw new Error("fixture");
  const result = computeWealth5(lead.lead.answers);
  const snap = buildWealth5Answers(lead.lead, result);
  check("快照每筆符合 SurveyAnswer 形狀（value 為陣列）", snap.every((s) => typeof s.questionId === "string" && typeof s.label === "string" && Array.isArray(s.value)));
  check("快照含總分／最弱領域／根源／分數帶／LINE／備註／原始作答", ["五力總分", "最弱領域", "根源維度", "分數帶", "LINE ID", "最想處理的事", "原始作答"].every((l) => snap.some((s) => s.label === l)));
  check("快照最弱領域用中文名（財富）", snap.find((s) => s.label === "最弱領域")?.value[0].startsWith("財富") === true);

  const links = { ...WEALTH5_DEFAULT_LINKS, talk1031: "" };
  const mail = buildWealth5ReportMail("王小明", result, links, "https://course.huangxi.info");
  const dim = WEALTH5_CONTENT.dims.find((d) => d.id === result.rootDim)!;
  check("根源為 D4 精神（非特例）", result.rootDim === "D4" && result.weakestArea === "A2");
  check("信主旨含最弱領域與根源", mail.subject.includes("財富") && mail.subject.includes(dim.name));
  check("信內含根源文案第一句", mail.body.includes(dim.root.split("。")[0]));
  check("信內含 90 天三個行動", dim.actions.every((x) => mail.body.includes(x)));
  check("信內含交叉解讀矩陣原文", mail.body.includes((WEALTH5_CONTENT.matrix as Record<string, Record<string, string>>)[result.rootDim][result.weakestArea]));
  check("nurture：講座 CTA 在課程 CTA 之前", result.ctaBand === "nurture" && mail.body.indexOf("先來聽聽看") < mail.body.indexOf("三合一進階"));
  check("空的 10/31 連結不產生按鈕", !mail.body.includes("[10/31 實體公益講座]"));
  check("站內相對連結轉絕對網址", mail.body.includes("https://course.huangxi.info/webinar/book-club"));
  check("讀冊會文案是每週三、不帶單一日期（Jason 2026-10-20）", mail.body.includes("每週三線上讀冊會") && !/11\/18/.test(mail.body) && !/11\/18/.test(HTML));
  check("信尾免責", mail.body.includes("非心理測驗、非醫療診斷"));

  const convert = computeWealth5(answersOf([4, 4, 4, 4, 3], 4));
  const m2 = buildWealth5ReportMail("A", convert, { ...links, talk1031: "https://www.seehope66.com/x" }, "https://course.huangxi.info");
  check("convert：課程 CTA 在講座 CTA 之前", convert.ctaBand === "convert" && m2.body.indexOf("三合一進階") < m2.body.indexOf("先來聽聽看"));
  check("有 10/31 連結時產生按鈕", m2.body.includes("[10/31 實體公益講座](https://www.seehope66.com/x)"));

  const health = computeWealth5(answersOf([4, 4, 1, 4, 4], { D3: [1, 1], D1: [5, 5], D2: [5, 5], D4: [5, 5], D5: [5, 5], D6: [5, 5], D7: [5, 5] }));
  const m3 = buildWealth5ReportMail("A", health, links, "https://course.huangxi.info");
  check("健康最弱：信內附醫療免責", m3.body.includes("不提供醫療建議"));
  check("A3×D3 特例文案（蓄電）", m3.body.includes("蓄電") && m3.subject.includes("元氣"));
}

console.log("\n路由契約");
{
  const hp = API.indexOf("isHoneypotTripped(");
  const parse = API.indexOf("parseWealth5Lead(body)");
  const throttle = API.indexOf("reserveCurrentFormAttempt(");
  const compute = API.indexOf("computeWealth5(lead.answers)");
  check("API：蜜罐在驗證之前", hp > 0 && parse > hp);
  check("API：蜜罐回假成功並留痕（recordBlockedWebinarAttempt）", /recordBlockedWebinarAttempt\(WEALTH5_CHECK_SLUG/.test(API));
  check("API：限流 reserveCurrentFormAttempt 在寫入之前", throttle > parse && throttle < API.indexOf("webinarRequest.upsert("));
  check("API：分數伺服器重算，不用前端 result", compute > 0 && !/fields\.result|body\.result|lead\.result/.test(API));
  check("API：寄信帶 webinarId（Resend webhook 回流寄送狀態）", /sendBroadcast\([\s\S]*?\{ webinarId: webinar\.id \}/.test(API));
  check("API：寄信失敗仍回 200 且標 FAILED", /deliveryStatus: "FAILED"/.test(API) && /return NextResponse\.json\(\{ ok: true \}\);\s*}\s*$/.test(API));
  check("API：三組名單（全部＋分數帶）", /WEALTH5_GROUP_NAMES\[result\.ctaBand\]/.test(API));
  check("API：同信箱 60 秒冷卻不重寄", /WEALTH5_RESEND_COOLDOWN_MS/.test(API) && /shouldSend/.test(API));
  check("API：手機選填，不合格式轉 null 不擋", /lead\.phoneRaw \? normalizeContactPhone\(lead\.phoneRaw\) : null/.test(API));
  check("API：學員記錄卡走 upsertStudent（同行者鐵則單一實作）", /upsertStudent\(normalizeMobile\(phone\), email, name\)/.test(API));
  check("API：不 import prisma 以外的寫入路徑（無 $executeRaw）", !/\$executeRaw|\$queryRaw/.test(API));

  check("GET：分頁管理關閉回 404", /isPageEnabled\("wealth5"\)/.test(PAGE) && /status: 404/.test(PAGE));
  check("GET：注入 JSON 逸出 <（防 </script> 跳脫）", /replace\(\/<\/g, "\\\\u003c"\)/.test(PAGE));
  check("GET：追蹤碼 ID 白名單字元", /\^\[A-Za-z0-9_-\]\{1,40\}\$/.test(PAGE));
  check("GET：回應 text/html 與 CDN 快取", /text\/html; charset=utf-8/.test(PAGE) && /s-maxage=60/.test(PAGE));
  check("GET：讀的是 src/content/wealth5-check.html", /src\/content\/wealth5-check\.html/.test(PAGE));
  check("next.config 明列檔案追蹤（Vercel 打包保險）", /outputFileTracingIncludes[\s\S]*wealth5-check\.html/.test(NEXT_CONFIG));
  check("site-pages 註冊 wealth5 → /check/wealth5", /key: "wealth5", path: "\/check\/wealth5"/.test(SITE_PAGES));
  check("/webinar/wealth5-check 導向檢測頁（不露出通用索取表單）", /slug === WEALTH5_CHECK_SLUG\) redirect\(WEALTH5_CHECK_PATH\)/.test(WEBINAR_PAGE));
}

console.log(`\n${fail === 0 ? "全部通過" : "有失敗"}（${pass} 項）${fail ? `，失敗 ${fail}` : ""}`);
if (fail > 0) process.exit(1);
