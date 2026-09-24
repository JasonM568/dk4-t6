/* 批次開通名單表單的「受控欄位」契約檢查（純離線，讀原始碼）。
 *
 * 擋的是 2026-09-24 那次整批匯入零開通：
 * 名單 textarea 用 defaultValue（非受控）。進頁面時還沒選場次，initialList 是
 * 空字串、textarea 掛載成空的；按「載入場次名單」是軟導航，client 元件實例被
 * 沿用，React 不會回頭改非受控欄位的值，所以文字框仍是空的。接著按送出，
 * required 讓瀏覽器擋下——沒有任何 POST，畫面也沒有錯誤訊息。
 * 0919 台北場 26 人就這樣一個都沒開通，而且不是第一次。
 *
 * 型別系統看不出 defaultValue 與 value 的差別，只能讀原始碼比對。
 * 跑法：npx tsx scripts/test-batch-enroll-form.ts */
import { readFileSync } from "node:fs";

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
const SRC = read("src/app/(admin)/admin/courses/[id]/members/members-manager.tsx");
const PAGE = read("src/app/(admin)/admin/courses/[id]/members/page.tsx");

/** 取出 name="list" 那個 textarea 的整段標籤 */
const textarea = SRC.match(/<textarea[^>]*name="list"[\s\S]*?\/>/)?.[0] ?? "";

console.log("\n名單欄位必須是受控的（這正是當初壞掉的地方）");
{
  check("找得到 name=\"list\" 的 textarea", textarea.length > 0);
  check(
    "不得使用 defaultValue —— 軟導航後不會更新，會送出空名單",
    !/defaultValue/.test(textarea),
    "改回 defaultValue 就等於把 2026-09-24 的零開通再做一次",
  );
  check("使用 value={...} 綁定", /value=\{/.test(textarea));
  check("有 onChange 才改得動", /onChange=\{/.test(textarea));
}

console.log("\n伺服器端送來新名單時要同步進畫面");
{
  check("元件有 useEffect", /useEffect/.test(SRC));
  check("useEffect 相依 initialList", /useEffect\([\s\S]*?\[initialList\]\)/.test(SRC));
  check(
    "用 ref 記住上一次的 initialList（只在真的換名單時覆寫，不洗掉手動編輯）",
    /lastInitial/.test(SRC) && /useRef/.test(SRC),
  );
}

console.log("\n名單空的時候要看得出來，不能只靠瀏覽器的驗證泡泡");
{
  check("名單為空時停用送出鈕", /disabled=\{adding \|\| list\.trim\(\)\.length === 0\}/.test(SRC));
  check("畫面上有提示或筆數", /名單是空的/.test(SRC) && /待處理/.test(SRC));
}

console.log("\n★ 送出按鈕必須跟「載入場次名單」在同一段流程裡（2026-09-24 事故的真正原因）");
{
  const pickerAt = PAGE.indexOf("從場次名單處理課後影片權限");
  const formAt = PAGE.indexOf("<BatchEnrollForm");
  const rosterAt = PAGE.indexOf("<RosterOverview");
  const managerAt = PAGE.indexOf("<CourseMembersManager");
  check("匯入表單是獨立元件 BatchEnrollForm", /export function BatchEnrollForm/.test(SRC));
  check("頁面有渲染 BatchEnrollForm", formAt > 0);
  check("匯入表單排在「載入場次名單」之後", formAt > pickerAt);
  check(
    "匯入表單排在「開通作業總覽」表格之前 —— 不可再被推到頁面下方",
    formAt < rosterAt,
    "被 28 列的總覽表格推下去，管理員就看不到那顆確認鈕了",
  );
  check("匯入表單排在下方名單元件之前", formAt < managerAt);
}

console.log("\n頁面仍須把場次名單組成 email,姓名 傳進元件");
{
  check("page 有組 initialList", /const initialList = sourceSession\?\.signups/.test(PAGE));
  check("過濾掉沒有 email 的人", /\.filter\(\(s\) => s\.email\?\.trim\(\)\)/.test(PAGE));
  check("email 一律小寫", /\.toLowerCase\(\)/.test(PAGE));
  check("initialList 有傳給匯入表單", /<BatchEnrollForm[\s\S]*?initialList=\{initialList\}/.test(PAGE));
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
