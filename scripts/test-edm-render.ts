/* EDM 內文渲染驗證：新語法（粗體/標題/分隔線/圖片）＋舊內容回歸相容。
 * 跑法：npx tsx scripts/test-edm-render.ts */
import {
  applyMergeTags,
  buildContentHtml,
  renderParagraph,
} from "../src/lib/email/render-content";

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

console.log("— 舊內容回歸（升級前的信件內文渲染結果不可變）—");
{
  const out = buildContentHtml("第一段\n第二行\n\n第二段 https://x.tw/a。\n\n[立即報名](https://x.tw/go)");
  check("純文字分段", out.split("<p ").length - 1 === 3);
  check("段內換行 <br />", out.includes("第一段<br />第二行"));
  check("明文網址自動連結、結尾標點不納入", out.includes('<a href="https://x.tw/a" target="_blank"'));
  check("CTA 按鈕", out.includes(">立即報名</a>") && out.includes("background-color: #d32f2f"));
  check("按鈕不殘留原始語法", !out.includes("[立即報名]"));
}
{
  const out = buildContentHtml('<script>alert("x")</script> & "quotes"');
  check("HTML 注入轉義", !out.includes("<script>") && out.includes("&lt;script&gt;"));
  check("& 與引號轉義", out.includes("&amp;") && out.includes("&quot;quotes&quot;"));
}
{
  check(
    "合併變數",
    applyMergeTags("Hi {name}（{email}）", { email: "a@b.c", name: "小明" }) ===
      "Hi 小明（a@b.c）",
  );
  check(
    "無姓名留空",
    applyMergeTags("Hi {name}", { email: "a@b.c" }) === "Hi ",
  );
}

console.log("— 新語法 —");
{
  const out = buildContentHtml("**重點**普通");
  check("粗體", out.includes("<strong>重點</strong>普通"));
  const multi = renderParagraph("**A** 與 **B**");
  check("同行多組粗體", multi.includes("<strong>A</strong>") && multi.includes("<strong>B</strong>"));
  check("未閉合 ** 不誤轉", !renderParagraph("**沒關").includes("<strong>"));
}
{
  const out = buildContentHtml("## 章節標題\n\n內文");
  check("標題段落（19px 粗體）", out.includes("font-size: 19px") && out.includes("章節標題"));
  check("內文段不受影響", out.includes("font-size: 15px"));
  check("段中 ## 不觸發", !buildContentHtml("行一\n## 不是標題").includes("font-size: 19px"));
}
{
  const out = buildContentHtml("上段\n\n---\n\n下段");
  check("分隔線", out.includes("<hr "));
  check("四個以上 - 也算", buildContentHtml("----").includes("<hr "));
  check("段中 --- 不觸發", !buildContentHtml("a\n---\nb").includes("<hr "));
}
{
  const out = buildContentHtml("![開課圖](https://img.x.tw/a.png)");
  check("圖片標籤", out.includes('<img src="https://img.x.tw/a.png" alt="開課圖"'));
  check("圖片全幅樣式", out.includes("width: 100%"));
  check("圖片語法不被按鈕吃掉", !out.includes(">開課圖</a>"));
  const mixed = renderParagraph("![圖](https://x.tw/i.png) 之後 [報名](https://x.tw/go)");
  check(
    "同行圖片＋按鈕並存",
    mixed.includes("<img src=") && mixed.includes(">報名</a>"),
  );
  check(
    "非 http(s) 圖片網址不轉",
    !renderParagraph("![x](javascript:alert(1))").includes("<img"),
  );
}
{
  check(
    "粗體包網址：** 不被網址吃進去",
    renderParagraph("**https://x.tw/a**").includes('href="https://x.tw/a"') &&
      !renderParagraph("**https://x.tw/a**").includes("**"),
  );
  check(
    "文字含「B12」不誤觸 placeholder 回填",
    renderParagraph("維他命 B12 [Go](https://x.tw)").includes("維他命 B12 "),
  );
  const escaped = renderParagraph('![<img onerror="x">](https://x.tw/i.png)');
  check("圖片 alt 轉義", !escaped.includes('onerror="x"'));
}

console.log(fail === 0 ? `\n全部通過（${pass} 項）` : `\n${fail} 項失敗（${pass} 項通過）`);
process.exit(fail === 0 ? 0 : 1);
