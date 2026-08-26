// EDM 內文渲染（純函式，無 server-only）：信件 HTML 與後台「即時預覽」共用
// 同一條路徑，預覽看到的就是寄出的內容，不會有兩套邏輯對不起來的問題。
//
// 支援語法（與自訂頁 RichText 一致，管理員學一套就好）：
//   空一行            → 分段
//   **文字**          → 粗體
//   ## 文字（行首）   → 標題（段落層級）
//   ---（獨立一段）   → 分隔線
//   ![說明](https://…) → 圖片（全幅，說明作 alt）
//   [文字](https://…)  → 紅色 CTA 按鈕
//   明文網址          → 自動轉連結

/** code = 該收件人所屬場次的 /live 上課碼（{code} 變數用）。
 *  跨場次群發時每個人的碼不同，所以綁在收件人身上（同 SmsRecipient）。 */
export type Recipient = { email: string; name?: string; code?: string };

// 合併變數：在「原文」階段替換，之後 esc() 會轉義 → 不會注入。
// 支援 {email}＝收件人 email、{name}＝姓名、{code}＝場次上課碼（皆無值時留空）。
export function applyMergeTags(text: string, r: Recipient): string {
  return text
    .replaceAll("{email}", r.email)
    .replaceAll("{name}", r.name ?? "")
    .replaceAll("{code}", r.code ?? "");
}

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const FONT_STACK =
  "-apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif";

// 圖片語法要先於按鈕抽出，否則 ![說明](網址) 的 [說明](網址) 部分會被按鈕規則吃掉
const IMAGE_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
// 內文 CTA 按鈕語法：[按鈕文字](https://網址)；只接受 http(s)，樣式與課程卡按鈕一致
const BUTTON_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
// 粗體：**文字**（不跨行、內容不含 *，避免貪婪吃過頭）
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;

// placeholder 以 NUL（\u0000）哨兵包夾：esc() 不動它、正常文字不可能出現
const PLACEHOLDER_RE = /\u0000B(\d+)\u0000/g;

/** 段落原文 → 段落內 HTML：
 *  ① 先抽出圖片、按鈕語法存 placeholder（\u0000Bn\u0000，esc 不會動到）
 *  ② 其餘文字 esc() 轉義（防注入的唯一入口，順序不可調換）
 *  ③ 粗體 **…** → <strong>（在自動連結前處理，粗體包網址時網址不會把 ** 吃進去）
 *  ④ 已轉義文字上把明文網址轉 <a>（href 用轉義後字串即合法 HTML attr；
 *     結尾中英文標點不納入網址）
 *  ⑤ 回填圖片/按鈕 HTML；換行轉 <br />
 *  明文網址與按鈕都是真 <a> 標籤 → Resend 點擊追蹤可改寫、點擊事件可回流 */
export function renderParagraph(p: string): string {
  const blocks: string[] = [];
  const stash = (html: string) => `\u0000B${blocks.push(html) - 1}\u0000`;

  let withPlaceholders = p.replace(IMAGE_RE, (_m, alt: string, url: string) =>
    stash(
      `<img src="${esc(url)}" alt="${esc(alt.trim())}" width="100%" style="display: block; width: 100%; max-width: 100%; border: 0; border-radius: 8px; margin: 4px 0;" />`,
    ),
  );
  withPlaceholders = withPlaceholders.replace(
    BUTTON_RE,
    (_m, label: string, url: string) =>
      stash(
        `<a href="${esc(url)}" target="_blank" style="display: inline-block; margin: 4px 0; padding: 12px 36px; background: linear-gradient(135deg, #b71c1c, #d32f2f); background-color: #d32f2f; font-family: ${FONT_STACK}; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">${esc(label.trim())}</a>`,
      ),
  );
  let html = esc(withPlaceholders);
  html = html.replace(BOLD_RE, "<strong>$1</strong>");
  // 網址遇到空白/CJK 字元（中文、全形標點——實務網址不含）、placeholder 哨兵即截斷，
  // 結尾半形標點不納入
  html = html.replace(
    /https?:\/\/[^\s<\u0000　-鿿豈-﫿＀-￯]+/g,
    (m) => {
      const url = m.replace(/[).,;:!?]+$/, "");
      const trail = m.slice(url.length);
      return `<a href="${url}" target="_blank" style="color: #b71c1c; word-break: break-all;">${url}</a>${trail}`;
    },
  );
  html = html.replace(PLACEHOLDER_RE, (_m, i: string) => blocks[Number(i)] ?? "");
  return html.replaceAll("\n", "<br />");
}

/** 內文純文字 → 段落 HTML 串（不含品牌信外框）。
 *  段落層級：`---` 獨立一段 = 分隔線；`## ` 開頭 = 標題（只取行首語法）。 */
export function buildContentHtml(bodyText: string): string {
  return bodyText
    .split(/\n{2,}/)
    .map((raw) => {
      const p = raw.trim();
      if (!p) return "";
      if (/^-{3,}$/.test(p)) {
        return `<hr style="border: 0; border-top: 1px solid #ecdfc2; margin: 24px 0;" />`;
      }
      if (p.startsWith("## ")) {
        return `<p style="margin: 24px 0 12px; font-family: ${FONT_STACK}; font-size: 19px; font-weight: bold; line-height: 1.5; color: #1a1a1a;">${renderParagraph(p.slice(3).trim())}</p>`;
      }
      return `<p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.9; color: #444444;">${renderParagraph(p)}</p>`;
    })
    .join("");
}
