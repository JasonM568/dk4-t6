/* 「單人開通」的靜態契約（純離線，讀原始碼）。掛在兩頁：批次開通頁（每列課程下拉）與
 * 課程觀看名單頁（課程固定、每列一顆開通鈕）。
 *
 * 守的是三件事：
 * 1. 找人與開通的表單欄位必須受控（React 19 useActionState 回錯會重置非受控欄位，
 *    見 2026-09-24 整批零開通事件與 react19-form-reset-uncontrolled 教訓）。
 * 2. 寫 Enrollment 的實作只有 grantEnrollmentAction 一份；單人模式不得另開寫入路徑。
 * 3. 搜尋走資料庫端過濾（searchProfiles＋上限），不得把全表抓下來過濾；守門 requireEditor。
 * 跑法：npx tsx scripts/test-single-enroll-form.ts */
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
const FORM = read("src/components/admin/single-enroll-form.tsx");
const PAGE = read("src/app/(admin)/admin/enrollments/page.tsx");
const COURSE_PAGE = read("src/app/(admin)/admin/courses/[id]/members/page.tsx");
const ACTIONS = read("src/actions/admin.ts");

function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}`);
  if (i < 0) return "";
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j < 0 ? undefined : j);
}

console.log("\n頁面掛載：單人開通在批次開通之前");
{
  const single = PAGE.indexOf("<SingleEnrollForm");
  const batch = PAGE.indexOf("<EnrollForm");
  check("頁面有渲染 SingleEnrollForm", single > 0);
  check("單人開通排在批次表單前面", single > 0 && batch > single);
  check("SingleEnrollForm 有拿到課程清單", /<SingleEnrollForm[^>]*courses=\{courses\}/.test(PAGE));
  check("批次開通區塊仍在（EnrollForm 沒被拿掉）", batch > 0);
}

console.log("\n課程觀看名單頁：單人開通（課程固定）在最上面");
{
  const single = COURSE_PAGE.indexOf("<SingleEnrollForm");
  const step1 = COURSE_PAGE.indexOf("步驟 1／2：從場次名單帶入名單");
  const batch = COURSE_PAGE.indexOf("<BatchEnrollForm");
  check("課程名單頁有渲染 SingleEnrollForm", single > 0);
  check("單人開通排在「步驟 1／2 帶入場次名單」之前", single > 0 && step1 > single);
  check("單人開通不插在步驟 1 與步驟 2 之間（2026-09-24 事故的相鄰關係不動）", step1 > 0 && batch > step1 && single < step1);
  check("課程固定：傳 fixedCourse={course}", /<SingleEnrollForm[^>]*fixedCourse=\{course\}/.test(COURSE_PAGE));
  check("只有可編輯者看得到（canEditNow 包住）", /canEditNow && \([\s\S]{0,120}<SingleEnrollForm/.test(COURSE_PAGE));
  const fixedStart = FORM.indexOf("{fixedCourse ? (", FORM.indexOf("function SingleEnrollRow("));
  const fixedForm = FORM.slice(fixedStart, FORM.indexOf(") : (", fixedStart));
  check("課程固定模式用 hidden courseId 帶課程（不另開 action）", /<input type="hidden" name="courseId" value=\{fixedCourse\.id\} \/>/.test(fixedForm));
  check("課程固定模式已開通者只顯示標記、不再出現開通鈕", /fixedEnrolled \? \(/.test(fixedForm) && /已開通本課程/.test(fixedForm));
  const grant = fnBody(ACTIONS, "grantEnrollmentAction");
  check("grantEnrollmentAction 開通後 revalidate 課程名單頁（下方名單即時多一人）", /revalidatePath\(`\/admin\/courses\/\$\{courseId\}\/members`\)/.test(grant));
}

console.log("\n表單欄位必須受控");
{
  const qInput = FORM.match(/<input[^>]*name="q"[\s\S]*?\/>/)?.[0] ?? "";
  check("找得到 name=\"q\" 的搜尋欄", qInput.length > 0);
  check("搜尋欄用 value={q} 綁定", /value=\{q\}/.test(qInput));
  check("搜尋欄不得用 defaultValue", !/defaultValue/.test(qInput));
  check("搜尋欄有 100 字上限（與 action 一致）", /maxLength=\{100\}/.test(qInput));
  const select = FORM.match(/<select[^>]*name="courseId"[\s\S]*?<\/select>/)?.[0] ?? "";
  check("找得到 name=\"courseId\" 的課程下拉", select.length > 0);
  check("課程下拉用 value={courseId} 綁定", /value=\{courseId\}/.test(select));
  check("課程下拉不得用 defaultValue", !/defaultValue/.test(select));
  check("每一列是獨立元件（各自一組 useActionState，不在 map 裡呼叫 hook）", /function SingleEnrollRow\(/.test(FORM));
}

console.log("\n開通只走 grantEnrollmentAction，不另開寫入路徑");
{
  check("元件呼叫 grantEnrollmentAction", /grantEnrollmentAction\(match\.userId/.test(FORM));
  check("元件不直接碰 prisma", !/prisma/.test(FORM));
  check("元件是 client component", FORM.startsWith('"use client"'));
  const search = fnBody(ACTIONS, "searchMemberForEnrollAction");
  check("searchMemberForEnrollAction 存在", search.length > 0);
  check("搜尋 action 不寫 Enrollment（只讀）", !/enrollment\.(create|upsert|update|delete)/.test(search));
  check("開通成功後本列把該課程從下拉移除（grantedIds）", /setGrantedIds/.test(FORM) && /grantedIds/.test(FORM));
}

console.log("\n搜尋走資料庫端過濾且有守門");
{
  const search = fnBody(ACTIONS, "searchMemberForEnrollAction");
  check("第一行先 requireEditor（總教練唯讀擋下）", /^\s*await requireEditor\(\);/m.test(search.split("\n").slice(0, 8).join("\n")));
  check("用 searchProfiles（資料庫端 ilike），不是 listProfiles 抓全表", /searchProfiles\(/.test(search) && !/listProfiles\(/.test(search));
  check("有回傳筆數上限 20", /SINGLE_ENROLL_SEARCH_LIMIT = 20/.test(ACTIONS) && /SINGLE_ENROLL_SEARCH_LIMIT\)/.test(search));
  check("關鍵字門檻走共用 isSearchableQuery", /isSearchableQuery\(query\)/.test(search));
  check("關鍵字長度上限 100", /query\.length > 100/.test(search));
  check("上限常數沒有 export（use server 檔案只能匯出 async 函式）", !/export const SINGLE_ENROLL_SEARCH_LIMIT/.test(ACTIONS));
  check("已封存會員有標記（archived）", /memberArchive\.findMany/.test(search) && /archived:/.test(search));
}

console.log(`\n${fail === 0 ? "全部通過" : "有失敗"}（${pass} 項）${fail ? `，失敗 ${fail}` : ""}`);
if (fail > 0) process.exit(1);
