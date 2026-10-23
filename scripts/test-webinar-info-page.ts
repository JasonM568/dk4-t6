/**
 * 活動資訊頁（/webinar/[slug]/info）＋填完表單直接給會議連結：離線靜態契約。
 *
 *   npx tsx scripts/test-webinar-info-page.ts
 *
 * 守的三件事：
 *   1. 資訊頁是公開網址，**不得**取 lectureUrl／meetingId／meetingPassword（落地頁欄位最小化）
 *   2. joinUrl 只在真的寄出（或 60 秒內剛寄過）時回給前端；蜜罐路徑與素材索取頁不帶
 *   3. 報名表單成功畫面有「直接進入會議」（有 joinUrl 才顯示）與「查看活動資訊」；後台列表列出資訊頁網址
 */
import fs from "node:fs";
import path from "node:path";
import { publicMeetingNotes } from "../src/lib/meeting";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
/** 取 export async function <name> 的本體（到下一個 export 為止） */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

console.log("A. 活動資訊頁（公開，不露連結）");
{
  const p = "src/app/webinar/[slug]/info/page.tsx";
  const src = read(p);
  const selectBlock = src.match(/select:\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  check("info 頁存在且用 select 白名單取欄位", selectBlock.length > 0);
  check("select 不取 lectureUrl", !/lectureUrl/.test(selectBlock));
  check("select 不取 meetingId", !/meetingId/.test(selectBlock));
  check("select 不取 meetingPassword", !/meetingPassword/.test(selectBlock));
  check("整頁沒出現 lectureUrl／meetingPassword 字樣（連註解外的程式碼都不能摸）",
    !/webinar\.(lectureUrl|meetingId|meetingPassword)/.test(src));
  check("meetingInfo 一律先過 publicMeetingNotes 才渲染（正式站曾把整段 Zoom 邀請貼進這欄）",
    /publicMeetingNotes\(webinar\.meetingInfo\)/.test(src) && !/\{webinar\.meetingInfo\}/.test(src));
  check("有顯示 DM 與說明", /webinar\.dmImage/.test(src) && /webinar\.description/.test(src));
  check("結束判斷與報名頁同一套（isActive＋hasEndedInTaipei＋unpublishAt）",
    /webinar\.isActive\s*&&[\s\S]*hasEndedInTaipei\(webinar\.endDate\)[\s\S]*unpublishAt/.test(src));
  check("開放中才給「前往報名頁」按鈕", /open\s*\?/.test(src) && /前往報名頁/.test(src));
  check("五力檢測 slug 一樣導去檢測頁", /WEALTH5_CHECK_SLUG\)\s*redirect\(WEALTH5_CHECK_PATH\)/.test(src));
  check("force-dynamic（到期要即時）", /export const dynamic = "force-dynamic"/.test(src));
}

console.log("\nA2. publicMeetingNotes：公開頁過濾（純函式）");
{
  const sample = [
    "10/28（二）19:30 開放進場，請提前 10 分鐘上線。",
    "",
    "Jason 邀請你參加 Zoom 會議。",
    "加入 Zoom 會議",
    "https://us02web.zoom.us/j/81234567890?pwd=AbCdEf123",
    "會議 ID：812 3456 7890",
    "密碼：668866",
    "Meeting ID: 81234567890",
    "Passcode: 668866",
    "www.zoom.us 也可以手動輸入",
    "進場後請改名為「姓名＿地區」。",
  ].join("\n");
  const out = publicMeetingNotes(sample);
  check("保留時間行", /19:30 開放進場/.test(out));
  check("保留注意事項行", /改名為/.test(out));
  check("保留一般文字行", /邀請你參加/.test(out) && /加入 Zoom 會議/.test(out));
  check("丟掉網址行", !/zoom\.us\/j/.test(out) && !/pwd=/.test(out));
  check("丟掉 www. 行", !/www\./.test(out));
  check("丟掉中文會議 ID 行", !/812 3456 7890/.test(out));
  check("丟掉中文密碼行", !/668866/.test(out));
  check("丟掉英文 Meeting ID／Passcode 行", !/Meeting ID/.test(out) && !/Passcode/.test(out));
  check("空值回空字串", publicMeetingNotes(null) === "" && publicMeetingNotes("") === "");
  check("全是敏感行時回空字串（頁面就不渲染區塊）", publicMeetingNotes("https://zoom.us/j/1\n密碼：1") === "");
}

console.log("\nB. 送出 action：joinUrl 只在寄出時回");
{
  const src = read("src/actions/webinar.ts");
  const body = fnBody(src, "requestWebinarLinkAction");
  check("state 型別有 joinUrl?", /joinUrl\?:\s*string/.test(src));
  const honeypot = body.slice(0, body.indexOf("const email ="));
  check("蜜罐路徑（取 email 之前）的 return 不帶 joinUrl", honeypot.length > 0 && !/joinUrl/.test(honeypot));
  const returns = body.match(/return \{[\s\S]*?\};/g) ?? [];
  const withJoin = returns.filter((r) => /joinUrl/.test(r));
  check("恰好兩處 return 帶 joinUrl（60 秒內剛寄過＋寄出成功）", withJoin.length === 2, `實際 ${withJoin.length}`);
  check("每處都排除素材索取（kind === \"RESOURCE\" 不給）",
    withJoin.every((r) => /kind === "RESOURCE" \? \{\} :/.test(r)));
  check("錯誤 return 都不帶 joinUrl", returns.filter((r) => /error:/.test(r)).every((r) => !/joinUrl/.test(r)));
  check("寄出成功那條用 buildWebinarMail 回的 joinUrl（與信裡同一條，含密碼）",
    /const \{ subject, body, joinUrl \} = buildWebinarMail\(/.test(body));
  check("剛寄過那條用 buildJoinUrl(lectureUrl, meetingPassword)",
    /buildJoinUrl\(webinar\.lectureUrl, webinar\.meetingPassword\)/.test(body));
}

console.log("\nC. 報名表單成功畫面");
{
  const src = read("src/app/webinar/[slug]/request-form.tsx");
  const success = src.slice(src.indexOf("if (state?.success) {"), src.indexOf("return (\n    <form action={action}"));
  check("成功畫面有「查看活動資訊」連到 /webinar/<slug>/info",
    /href=\{`\/webinar\/\$\{slug\}\/info`\}/.test(success) && /查看活動資訊/.test(success));
  check("「直接進入會議」只在 state.joinUrl 存在時渲染", /state\.joinUrl && \(/.test(success) && /直接進入會議/.test(success));
  check("會議連結另開分頁且 rel=noreferrer", /href=\{state\.joinUrl\}[\s\S]{0,120}target="_blank"[\s\S]{0,60}rel="noreferrer"/.test(success));
  check("重寄表單仍在（60 秒冷卻文案沒被拿掉）", /秒後可重寄/.test(success));
}

console.log("\nD. 後台列表");
{
  const src = read("src/app/(admin)/admin/webinars/webinars-manager.tsx");
  check("報名頁網址底下多一列「活動資訊頁網址」", /報名頁網址：[\s\S]*活動資訊頁網址：/.test(src));
  check("資訊頁網址 = 報名頁網址 + /info", /const infoUrl = `\$\{url\}\/info`/.test(src));
  check("有「開啟資訊頁」與複製", /開啟資訊頁/.test(src) && /writeText\(infoUrl\)/.test(src));
}

console.log(`\n${fail === 0 ? "🎉" : "💥"} 通過 ${pass}／${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
