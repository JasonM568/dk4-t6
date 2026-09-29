/* 名單收集信件組裝驗證（純離線）。
 *
 * 新增「素材清單」之後最該守的是**既有 5 個講座頁行為零變化**：
 * 它們沒有素材、只有 lectureUrl，信件必須跟以前一模一樣。
 * 其次才是素材清單要正確渲染成按鈕列。
 *
 * 跑法：npx tsx scripts/test-lead-capture-mail.ts */
import { buildWebinarMail, defaultEmailBody, type WebinarMailSource } from "../src/lib/webinar-mail";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`); }
}
const TO = { name: "王小明", email: "a@b.com" };
const base: WebinarMailSource = {
  lectureUrl: "https://zoom.us/j/123",
  meetingId: "123 456",
  meetingPassword: "pw99",
  meetingInfo: "請提早五分鐘進入",
  emailSubject: "{name} 你好，這是你的連結",
  emailBody: "感謝索取。",
};

console.log("\n回歸：沒有素材清單時，行為與加素材功能之前完全相同");
{
  const r = buildWebinarMail(base, TO);
  check("主旨套用 {name}", r.subject === "王小明 你好，這是你的連結");
  check("內文沒放連結時自動補「進入講座」按鈕", r.body.includes("[▶️ 進入講座]"));
  check("按鈕指向帶密碼的會議連結", r.body.includes(r.joinUrl));
  check("信末附會議資訊", r.body.includes("📌 會議資訊") && r.body.includes("123 456"));
  const withLink = buildWebinarMail({ ...base, emailBody: "點這裡 {link} 謝謝" }, TO);
  check("內文已有 {link} 時不重複補按鈕", !withLink.body.includes("[▶️ 進入講座]"));
}

console.log("\n素材清單渲染成按鈕列");
{
  const r = buildWebinarMail({
    ...base,
    kind: "RESOURCE",
    assets: [
      { title: "完整影片", url: "https://youtu.be/abc", note: "未列出連結，請勿外流" },
      { title: "課程講義 PDF", url: "https://x.co/a.pdf" },
    ],
  }, TO);
  check("第一筆素材渲染成連結", r.body.includes("[完整影片](https://youtu.be/abc)"));
  check("第二筆素材也在", r.body.includes("[課程講義 PDF](https://x.co/a.pdf)"));
  check("素材說明有帶出來", r.body.includes("未列出連結，請勿外流"));
  check("RESOURCE 不附會議資訊", !r.body.includes("📌 會議資訊"));
  check("不再出現「進入講座」按鈕", !r.body.includes("進入講座"));
}

console.log("\n素材清單的邊界");
{
  const empty = buildWebinarMail({ ...base, assets: [] }, TO);
  check("空清單退回單一連結行為", empty.body.includes("[▶️ 進入講座]"));
  const blank = buildWebinarMail({ ...base, assets: [{ title: "  ", url: "  " }] }, TO);
  check("標題或網址空白的素材被濾掉", blank.body.includes("[▶️ 進入講座]"));
  const placed = buildWebinarMail({
    ...base,
    emailBody: "先看這個：\n\n{assets}\n\n有問題再問我",
    assets: [{ title: "影片", url: "https://y.co/1" }],
  }, TO);
  check("管理員自己放 {assets} 時就地展開", placed.body.includes("先看這個：") &&
    placed.body.indexOf("[影片]") > placed.body.indexOf("先看這個"));
  check("不在結尾重複追加一份", placed.body.split("[影片]").length === 2);
  const single = buildWebinarMail({
    ...base,
    emailBody: "你的檔案：{link}",
    assets: [{ title: "影片", url: "https://y.co/1" }],
  }, TO);
  check("有素材時 {link} 指向第一筆素材", single.body.includes("你的檔案：https://y.co/1"));
}

console.log("\n★ 內文含 {link}（講座版預設模板）時，素材清單仍必須渲染——2026-09-29 測試頁抓到的 bug");
{
  const r = buildWebinarMail({
    ...base, kind: "RESOURCE",
    emailBody: defaultEmailBody("WEBINAR"), // 舊模板：有 {link} 與「進入講座」
    assets: [
      { title: "完整影片", url: "https://youtu.be/abc", note: "請勿外流" },
      { title: "講義", url: "https://x.co/a.pdf" },
    ],
  }, TO);
  check("第一筆素材按鈕有渲染", r.body.includes("[完整影片](https://youtu.be/abc)"));
  check("第二筆素材按鈕有渲染", r.body.includes("[講義](https://x.co/a.pdf)"));
  check("素材說明有渲染", r.body.includes("請勿外流"));
  check("{link} 仍指向第一筆素材", r.body.includes("請直接開啟：https://youtu.be/abc"));
}

console.log("\n預設內文依類型，且只有 lib 這一份");
{
  const res = defaultEmailBody("RESOURCE");
  check("素材索取版含 {assets}", res.includes("{assets}"));
  check("素材索取版不寫「進入講座」", !res.includes("進入講座"));
  const web = defaultEmailBody("WEBINAR");
  check("講座版含「進入講座」與 {link}（既有行為不變）", web.includes("[▶️ 進入講座]({link})"));
  check("沒給類型＝講座版", defaultEmailBody(undefined) === web);
  const rendered = buildWebinarMail({ ...base, kind: "RESOURCE", emailBody: res,
    assets: [{ title: "影片", url: "https://y.co/1" }] }, TO);
  check("素材索取版預設內文渲染後只有一份清單、沒有重複追加", rendered.body.split("[影片]").length === 2);
}

console.log("\nRESOURCE 但沒有素材清單時，CTA 文案改成取得資料");
{
  const r = buildWebinarMail({ ...base, kind: "RESOURCE", meetingId: null, meetingPassword: null, meetingInfo: null }, TO);
  check("按鈕寫「取得資料」而不是「進入講座」", r.body.includes("[⬇️ 取得資料]"));
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
