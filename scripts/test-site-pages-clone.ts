/**
 * 舊官網五頁複刻（關於我們／量子講師群／學員見證／首頁院長介紹／院長乾貨區）離線契約。
 *
 *   npx tsx scripts/test-site-pages-clone.ts
 *
 * 守的三件事：
 *   1. 匯入文章的 HTML 消毒：script／on*／javascript: 全丟、iframe 只放行白名單主機、圖片音訊只收 https、
 *      WP 圖庫／嵌入／表格留著（這是全專案唯一的 dangerouslySetInnerHTML 入口）
 *   2. 匯入轉換：分類→tags、搶先試看→PUBLIC、其餘 SUBSCRIBER、slug wp-<id>、摘要 120 字、封面對應 media
 *   3. 頁面靜態契約：四頁有分頁開關、註冊在 SITE_PAGES、CSP 放行需要的主機、見證 22 支 reel 用 iframe 不載 embed.js、
 *      後台列表不帶 contentHtml 給 client
 */
import fs from "node:fs";
import path from "node:path";
import { sanitizeArticleHtml, htmlToText, ARTICLE_IFRAME_HOSTS } from "../src/lib/article-html";
import { KNOWLEDGE_CATEGORIES, categoryNameFromTitle, knowledgeCategoryBySlug } from "../src/lib/knowledge-categories";
import { SITE_PAGES } from "../src/lib/site-pages";
import { TESTIMONIAL_REELS, reelEmbedUrl } from "../src/lib/site-content/testimonials";
import { LECTURER_CARDS, LECTURERS_GROUP_IMAGE } from "../src/lib/site-content/lecturers";
import { ABOUT_FEATURES, CHANCELLOR } from "../src/lib/site-content/about";
import { convertPost } from "./import-wp-knowledge";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

console.log("A. sanitizeArticleHtml");
{
  const out = sanitizeArticleHtml(`<p class="wp-block-paragraph" onclick="x()">hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.test/x">ok</a></p>`);
  check("script 整段丟掉", !/alert\(1\)|<script/.test(out));
  check("on* 屬性丟掉", !/onclick/.test(out));
  check("javascript: 連結的 href 丟掉", !/javascript:/.test(out));
  check("https 連結保留並加 target=_blank rel=noopener", /<a href="https:\/\/ok\.test\/x" target="_blank" rel="noopener noreferrer">ok<\/a>/.test(out), out);
  check("wp-* class 保留", /class="wp-block-paragraph"/.test(out));
  const cls = sanitizeArticleHtml(`<div class="wp-block-group bg-red-500 text-9xl">x</div>`);
  check("非 wp-* 的 class 被拿掉（防止匯入內容借用 tailwind 排版）", /class="wp-block-group"/.test(cls) && !/bg-red/.test(cls), cls);
  const ifr = sanitizeArticleHtml(`<iframe src="https://embed.podcasts.apple.com/us/podcast/x?i=1"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe><iframe src="https://evil.example/embed"></iframe><iframe src="http://www.youtube.com/embed/abc"></iframe>`);
  check("Apple Podcasts 與 YouTube iframe 保留", /embed\.podcasts\.apple\.com/.test(ifr) && /youtube\.com\/embed\/abc/.test(ifr));
  check("白名單外主機的 iframe 丟掉", !/evil\.example/.test(ifr));
  check("http（非 https）的 iframe 丟掉", (ifr.match(/<iframe/g) ?? []).length === 2, ifr);
  check("白名單主機清單含 videopress", ARTICLE_IFRAME_HOSTS.includes("videopress.com"));
  const img = sanitizeArticleHtml(`<figure class="wp-block-gallery"><figure class="wp-block-image"><img src="https://cdn.test/a.webp" alt="a" width="1" height="2"/></figure><img src="http://cdn.test/b.webp"/><img src="data:image/png;base64,AAAA"/></figure>`);
  check("https 圖片保留並加 loading=lazy", /<img src="https:\/\/cdn\.test\/a\.webp" alt="a" width="1" height="2" loading="lazy"/.test(img) && /wp-block-gallery/.test(img), img);
  check("http／data: 圖片 src 丟掉", !/http:\/\/cdn|data:image/.test(img));
  const au = sanitizeArticleHtml(`<audio controls src="https://cdn.test/a.mp3"></audio><table class="wp-block-table"><tr><td colspan="2">x</td></tr></table>`);
  check("audio 與 table 保留", /<audio controls src="https:\/\/cdn\.test\/a\.mp3">/.test(au) && /<td colspan="2">x<\/td>/.test(au), au);
  check("style 標籤連內容丟掉", !/color/.test(sanitizeArticleHtml(`<style>p{color:red}</style><p>a</p>`)));
  check("空值回空字串", sanitizeArticleHtml(null) === "" && sanitizeArticleHtml("") === "");
  check("htmlToText 去標籤、不含 iframe／figure 內容、合併空白", htmlToText(`<p>a&nbsp; b</p><iframe src="https://x">zzz</iframe><figure><img alt="q"/></figure>\n<p>c</p>`) === "a b c", JSON.stringify(htmlToText(`<p>a&nbsp; b</p><iframe src="https://x">zzz</iframe>\n<p>c</p>`)));
}

console.log("\nB. 匯入轉換 convertPost");
{
  const media = new Map([[9, { id: 9, source_url: "https://cdn.test/cover.webp" }]]);
  const base = { date: "2026-10-27T09:28:00", date_gmt: "2026-10-27T01:28:00", modified_gmt: "2026-10-27T01:28:00", slug: "x", status: "publish", link: "https://academy4hope.com/57779/", excerpt: { rendered: "" }, featured_media: 9 };
  const sub = convertPost({ ...base, id: 57779, title: { rendered: "【新聞速報】2026/10/27" }, content: { rendered: `<figure class="wp-block-gallery"><img src="https://cdn.test/1.webp"/></figure>` }, categories: [22, 31, 23] }, media);
  check("slug = wp-<id>、wpId、sourceUrl", sub.slug === "wp-57779" && sub.wpId === 57779 && sub.sourceUrl === "https://academy4hope.com/57779/");
  check("WP 分類 31 → tags ['新聞速報']", JSON.stringify(sub.tags) === JSON.stringify(["新聞速報"]));
  check("非試看 → SUBSCRIBER + PUBLISHED", sub.visibility === "SUBSCRIBER" && sub.status === "PUBLISHED");
  check("封面由 media 對應", sub.coverImage === "https://cdn.test/cover.webp");
  check("publishedAt 以 date_gmt 當 UTC", sub.publishedAt.toISOString() === "2026-10-27T01:28:00.000Z");
  check("只有圖的文章摘要有替代文字、content 不為空", sub.summary.includes("新聞速報") && sub.content.length > 0);
  check("contentHtml 已消毒且保留圖庫", /wp-block-gallery/.test(sub.contentHtml) && /loading="lazy"/.test(sub.contentHtml));
  const long = "字".repeat(300);
  const free = convertPost({ ...base, id: 2, featured_media: 0, title: { rendered: "【晨間小語】行動方程式 &#8217;" }, content: { rendered: `<p>${long}</p>` }, categories: [38, 40] }, media);
  check("搶先試看樹（38/40）→ PUBLIC，分類由標題【】判斷，tags 另加「搶先試看」", free.visibility === "PUBLIC" && JSON.stringify(free.tags) === JSON.stringify(["晨間小語", "搶先試看"]), JSON.stringify(free.tags));
  check("標題 HTML entity 解碼", free.title === "【晨間小語】行動方程式 ’");
  check("摘要截 120 字加「…」", free.summary.length === 121 && free.summary.endsWith("…"));
  const emoji = convertPost({ ...base, id: 4, title: { rendered: "【財經快報】x" }, content: { rendered: `<p>${"📈".repeat(150)}</p>` }, categories: [32] }, media);
  check("摘要以 code point 截字，emoji 不會被切成落單 surrogate（曾讓 Prisma InvalidArg）", Array.from(emoji.summary).length === 121 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji.summary) && JSON.parse(JSON.stringify(emoji.summary)) === emoji.summary);
  const noGmt = convertPost({ ...base, id: 5, date_gmt: null, title: { rendered: "【晨間小語】y" }, content: { rendered: "<p>y</p>" }, categories: [38] }, media);
  check("沒有 date_gmt 時用 date 當台北時間", noGmt.publishedAt.toISOString() === "2026-10-27T01:28:00.000Z");
  check("沒封面 → null", free.coverImage === null);
  const none = convertPost({ ...base, id: 3, title: { rendered: "沒有分類的文章" }, content: { rendered: "<p>x</p>" }, categories: [22, 1] }, media);
  check("分類判不出來 → tags 空（只在「全部」出現，不誤歸類）", none.tags.length === 0);
  check("categoryNameFromTitle 只認六個分類", categoryNameFromTitle("【財經快報】x") === "財經快報" && categoryNameFromTitle("【隨便】x") === null && categoryNameFromTitle("x") === null);
  check("knowledgeCategoryBySlug", knowledgeCategoryBySlug("morning")?.name === "晨間小語" && knowledgeCategoryBySlug("nope") === null && knowledgeCategoryBySlug(undefined) === null);
  check("六個分類 slug 不重複", new Set(KNOWLEDGE_CATEGORIES.map((c) => c.slug)).size === 6);
}

console.log("\nC. 頁面與註冊表");
{
  const keys = SITE_PAGES.map((p) => p.key);
  check("SITE_PAGES 註冊 about／lecturers／knowledge／testimonials", ["about", "lecturers", "knowledge", "testimonials"].every((k) => keys.includes(k as never)));
  check("knowledge 分頁標題改為「院長乾貨區」", SITE_PAGES.find((p) => p.key === "knowledge")?.title === "院長乾貨區");
  for (const [file, key] of [["src/app/(shop)/about/page.tsx", "about"], ["src/app/(shop)/lecturers/page.tsx", "lecturers"], ["src/app/(shop)/testimonials/page.tsx", "testimonials"], ["src/app/(shop)/knowledge/page.tsx", "knowledge"]] as const) {
    const src = read(file);
    check(`${file} 有分頁開關＋force-dynamic`, new RegExp(`isPageEnabled\\("${key}"\\)`).test(src) && /force-dynamic/.test(src));
  }
  check("首頁有院長介紹且跟「關於我們」開關連動", /isPageEnabled\("about"\)/.test(read("src/app/page.tsx")) && /<ChancellorIntro compact \/>/.test(read("src/app/page.tsx")));
  check("關於我們用同一個 ChancellorIntro（文案單一來源）", /<ChancellorIntro \/>/.test(read("src/app/(shop)/about/page.tsx")));
  check("院長文案：兩段引言＋現任 4＋曾任 5", CHANCELLOR.quote.length === 2 && CHANCELLOR.current.length === 4 && CHANCELLOR.past.length === 5);
  check("特色 6 項、圖示在 public/site/about", ABOUT_FEATURES.length === 6 && ABOUT_FEATURES.every((f) => fs.existsSync(path.join(ROOT, "public", f.icon))));
  check("講師群：1 合照＋6 講師卡，全在 Supabase Storage 不連舊站 CDN", LECTURER_CARDS.length === 6 && [LECTURERS_GROUP_IMAGE, ...LECTURER_CARDS].every((i) => i.src.includes(".supabase.co/storage/v1/object/public/course-assets/site/")));
  check("學員見證 22 支 reel、代碼不重複", TESTIMONIAL_REELS.length === 22 && new Set(TESTIMONIAL_REELS).size === 22);
  check("reel 用 instagram.com/reel/<code>/embed/ iframe", reelEmbedUrl("abc") === "https://www.instagram.com/reel/abc/embed/");
  const t = read("src/app/(shop)/testimonials/page.tsx");
  check("見證頁 iframe 有 sandbox＋lazy，沒有 <script>（不載 instagram embed.js）", /sandbox="allow-scripts allow-same-origin allow-popups"/.test(t) && /loading="lazy"/.test(t) && !/<script/i.test(t) && !/<Script/.test(t));
  const csp = read("next.config.ts");
  check("CSP frame-src 放行 instagram／podcasts／videopress", /frame-src[^"]*embed\.podcasts\.apple\.com/.test(csp) && /frame-src[^"]*www\.instagram\.com/.test(csp) && /frame-src[^"]*videopress\.com/.test(csp));
  check("CSP img-src／media-src 放行舊站 CDN", /img-src[^`]*academy4hope-com\.sfo3\.cdn\.digitaloceanspaces\.com/.test(csp) && /media-src[^`]*academy4hope-com\.sfo3\.cdn\.digitaloceanspaces\.com/.test(csp));
  const list = read("src/app/(shop)/knowledge/page.tsx");
  check("乾貨區列表有分類頁籤＋分頁＋鎖頭標示", /KNOWLEDGE_CATEGORIES\.map/.test(list) && /PAGE_SIZE/.test(list) && /skip:/.test(list) && /🔒/.test(list));
  check("列表 select 不取 contentHtml／content（2,000 篇不能整篇撈）", !/contentHtml/.test(list.slice(list.indexOf("select:"))) && /select: \{ id: true, slug: true, title: true, summary: true/.test(list));
  const art = read("src/app/(shop)/knowledge/[slug]/page.tsx");
  check("文章頁：有 contentHtml 走 ArticleHtml，否則 RichText", /article\.contentHtml \? <ArticleHtml html=\{article\.contentHtml\} \/> : <RichText/.test(art));
  check("ArticleHtml 是唯一的 dangerouslySetInnerHTML，且先過 sanitizeArticleHtml", (() => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("dangerouslySetInnerHTML={{")) hits.push(path.relative(ROOT, p)); } };
    walk(path.join(ROOT, "src"));
    const comp = read("src/components/article-html.tsx");
    // 既有的實際用法只有 /live（JSON-LD 類固定字串）與 EDM 預覽（後台管理員自己的內容），不准再長新的
    const allowed = new Set(["src/components/article-html.tsx", "src/app/live/page.tsx", "src/app/(admin)/admin/broadcast/broadcast-form.tsx"]);
    return hits.includes("src/components/article-html.tsx") && hits.every((h) => allowed.has(h)) && /sanitizeArticleHtml\(html\)/.test(comp);
  })());
  const admin = read("src/app/(admin)/admin/settings/knowledge/page.tsx");
  check("後台列表 take 100、select 不含 contentHtml", /take: 100/.test(admin) && !/contentHtml: true/.test(admin) && /wpId: true/.test(admin));
  const imp = read("scripts/import-wp-knowledge.ts");
  check("匯入腳本預設 dry-run、遠端 DB 要 --allow-remote、以 wpId upsert", /--allow-remote/.test(imp) && /where: \{ wpId \}/.test(imp) && /if \(!apply\) return;/.test(imp));
}

console.log(`\n${fail === 0 ? "🎉" : "💥"} 通過 ${pass}／${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
