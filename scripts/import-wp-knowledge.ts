/* 舊官網（academy4hope.com WordPress）院長乾貨區 → KnowledgeArticle 匯入。
 *
 *   npx tsx --conditions=react-server scripts/import-wp-knowledge.ts --dir <資料夾> [--apply] [--allow-remote]
 *
 * 資料夾內容（由 ego 瀏覽器以後台登入狀態從 REST API 抓下來）：
 *   posts/page-*.json        categories=22（院長乾貨區）全部文章，context=edit（含 content.raw/rendered）
 *   posts/public-cat38.json  categories=38（搶先試看）公開文章
 *   media.json               featured_media id → source_url
 *
 * 規則：
 *   - 冪等：以 wpId upsert，重跑只更新內容不會重複
 *   - 分類 → tags：新聞速報／財經快報／全球財經／顧名思易／晨間小語（先看 WP 分類，再看標題【】）
 *   - 可見性：在「搶先試看」分類樹下的 PUBLIC（tags 另加「搶先試看」），其餘 SUBSCRIBER
 *   - 內文：content.rendered 經 sanitizeArticleHtml 存進 contentHtml；content 存純文字備援；summary 取前 120 字
 *   - 排除「新聞速報」（WP 分類 31，711 篇純新聞截圖圖庫、3.5 萬張圖約 9.3GB，2026-10-28 Jason 決定不搬）；
 *     --apply 時會把先前匯入過的排除分類文章一併刪掉，重跑結果一致
 *   - 圖片／音訊：先跑 scripts/mirror-wp-media.ts 把檔案複製到 Supabase Storage 並產出 <資料夾>/media-map.json，
 *     本腳本讀到對照表就把內文與封面的舊站 CDN 網址改寫成 Storage 網址；沒有對照表就維持原網址（會印警告）
 *   - 預設 dry-run 不寫入；DATABASE_URL 非 localhost 時必須加 --allow-remote（正式站匯入要 Jason 點頭）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../src/lib/db";
import { htmlToText, sanitizeArticleHtml } from "../src/lib/article-html";
import { KNOWLEDGE_CATEGORIES, categoryNameFromTitle } from "../src/lib/knowledge-categories";

export type WpPost = {
  id: number; date: string; date_gmt?: string | null; modified_gmt?: string; slug: string; status: string; link: string;
  title: { rendered: string; raw?: string }; content: { rendered: string; raw?: string };
  excerpt: { rendered: string; raw?: string }; featured_media: number; categories: number[];
};
export type WpMedia = { id: number; source_url: string; alt_text?: string };

const CATEGORY_BY_WP_ID: Record<number, string> = {
  32: "財經快報", 30: "全球財經", 29: "顧名思易", 34: "晨間小語",
};
/** 不搬的 WP 分類：31 新聞速報（每日新聞截圖圖庫，Jason 2026-10-28 決定排除） */
export const EXCLUDED_WP_CATEGORY_IDS = new Set([31]);
export const OLD_CDN_HOST = "academy4hope-com.sfo3.cdn.digitaloceanspaces.com";
export const MEDIA_MAP_FILE = "media-map.json";
/** 舊網址 → Storage 公開網址（由 mirror-wp-media.ts 產出） */
export type MediaMap = Map<string, string>;
const FREE_CATEGORY_IDS = new Set([38, 40, 41, 42]); // 搶先試看／試看文章／讀冊會講義／量子初階講義
const FREE_TAG = "搶先試看";

function isLocalDb(raw: string | undefined): boolean {
  try { return !!raw && ["localhost", "127.0.0.1"].includes(new URL(raw).hostname); } catch { return false; }
}

// Postgres text 不能存 NUL；落單的 UTF-16 surrogate（emoji 被切一半）會讓 Prisma 以 InvalidArg
// （unexpected end of hex escape）整批失敗——摘要截字一律用 code point 切，另外把落單 surrogate 清掉
const stripNul = (s: string) => s.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
const SUMMARY_LEN = 120;
function truncateSummary(text: string): string {
  const cps = Array.from(text);
  return cps.length > SUMMARY_LEN ? `${cps.slice(0, SUMMARY_LEN).join("")}…` : text;
}
/** date_gmt 是 UTC；少數抓法（_fields 沒帶 date_gmt）只有 date（台北時間） */
function publishedAtOf(p: WpPost): Date {
  if (p.date_gmt) return new Date(`${p.date_gmt}Z`);
  return new Date(`${p.date}+08:00`);
}

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#8217;/g, "’").replace(/&nbsp;/g, " ");
}

/** 讀匯出資料夾：只取已發布、且不在排除分類的文章 */
export function loadExport(dir: string): { posts: Map<number, WpPost>; excluded: WpPost[]; media: Map<number, WpMedia>; mediaMap: MediaMap | null } {
  const posts = new Map<number, WpPost>();
  const excluded: WpPost[] = [];
  for (const f of fs.readdirSync(path.join(dir, "posts")).filter((x) => x.endsWith(".json")).sort()) {
    for (const p of JSON.parse(fs.readFileSync(path.join(dir, "posts", f), "utf8")) as WpPost[]) {
      if (p.status !== "publish") continue;
      if (p.categories.some((id) => EXCLUDED_WP_CATEGORY_IDS.has(id))) { excluded.push(p); continue; }
      posts.set(p.id, p);
    }
  }
  const media = new Map<number, WpMedia>();
  for (const m of JSON.parse(fs.readFileSync(path.join(dir, "media.json"), "utf8")) as WpMedia[]) if (m.id) media.set(m.id, m);
  const mapFile = path.join(dir, MEDIA_MAP_FILE);
  const mediaMap = fs.existsSync(mapFile) ? new Map(Object.entries(JSON.parse(fs.readFileSync(mapFile, "utf8")) as Record<string, string>)) : null;
  return { posts, excluded, media, mediaMap };
}

const MEDIA_URL_RE = /https?:\/\/[^"'\s<>]+/g;
const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|mp3|pdf)(\?[^"'\s<>]*)?$/i;
/** 一篇文章要鏡像的媒體網址：<img>／<audio>／<source> 的 src＋封面圖，以及舊站 CDN 上所有圖片／音訊／PDF 連結（燈箱連結指向原檔） */
export function collectMediaUrls(p: WpPost, media: Map<number, WpMedia>): string[] {
  const html = p.content.rendered;
  const out = new Set<string>();
  for (const m of html.matchAll(/<(?:img|audio|source)\b[^>]*\ssrc="([^"]+)"/g)) if (/^https?:\/\//.test(m[1])) out.add(m[1]);
  for (const m of html.matchAll(MEDIA_URL_RE)) if (m[0].includes(OLD_CDN_HOST) && MEDIA_EXT_RE.test(m[0])) out.add(m[0]);
  const cover = media.get(p.featured_media)?.source_url;
  if (cover) out.add(cover);
  return [...out];
}

/** mirror-wp-media.ts 收的 MIME → 副檔名（bucket course-assets 允許的子集；audio/mpeg 2026-10-28 加進 bucket 白名單） */
export const MIRROR_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/mpeg": "mp3", "application/pdf": "pdf",
};
const MIRROR_PREFIX = "knowledge/wp";
const SAFE_KEY = /^[A-Za-z0-9._/-]+$/;
/** Storage 內路徑：舊站 /wp-content/uploads/2024/05/x.webp → knowledge/wp/2024/05/x.webp；其他主機或怪字元／穿越 → knowledge/wp/ext/<sha1>.<ext> */
export function storageKeyFor(url: string, ext: string): string {
  const u = new URL(url);
  const m = /\/wp-content\/uploads\/(.+)$/.exec(u.pathname);
  if (u.hostname === OLD_CDN_HOST && m && SAFE_KEY.test(m[1]) && !m[1].includes("..")) return `${MIRROR_PREFIX}/${m[1]}`;
  return `${MIRROR_PREFIX}/ext/${crypto.createHash("sha1").update(url).digest("hex")}.${ext}`;
}

/** 用對照表改寫 HTML 內所有出現的舊網址（整段網址比對，不會把 a.jpg 換進 a.jpg?x 裡） */
export function rewriteMediaUrls(html: string, mediaMap: MediaMap | null): string {
  if (!mediaMap || mediaMap.size === 0) return html;
  return html.replace(MEDIA_URL_RE, (url) => mediaMap.get(url) ?? url);
}

export type Converted = {
  wpId: number; slug: string; title: string; summary: string; content: string; contentHtml: string;
  coverImage: string | null; tags: string[]; visibility: "PUBLIC" | "SUBSCRIBER"; status: "PUBLISHED";
  publishedAt: Date; sourceUrl: string; images: string[];
};

export function convertPost(p: WpPost, media: Map<number, WpMedia>, mediaMap: MediaMap | null = null): Converted {
  const title = stripNul(decodeEntities(p.title.rendered)).trim();
  const fromCategory = p.categories.map((id) => CATEGORY_BY_WP_ID[id]).find(Boolean);
  const category = fromCategory ?? categoryNameFromTitle(title);
  const isFree = p.categories.some((id) => FREE_CATEGORY_IDS.has(id));
  const tags = [...(category ? [category] : []), ...(isFree ? [FREE_TAG] : [])];
  const rendered = rewriteMediaUrls(p.content.rendered, mediaMap);
  const contentHtml = stripNul(sanitizeArticleHtml(rendered));
  const text = stripNul(htmlToText(rendered));
  const summary = text ? truncateSummary(text) : `${category ?? "院長乾貨區"}：圖片內容`;
  const cover = media.get(p.featured_media)?.source_url ?? null;
  return {
    wpId: p.id,
    slug: `wp-${p.id}`,
    title,
    summary,
    content: text || summary,
    contentHtml,
    coverImage: cover ? (mediaMap?.get(cover) ?? cover) : null,
    tags,
    visibility: isFree ? "PUBLIC" : "SUBSCRIBER",
    status: "PUBLISHED",
    publishedAt: publishedAtOf(p),
    sourceUrl: p.link,
    images: [],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : "";
  const apply = args.includes("--apply");
  const allowRemote = args.includes("--allow-remote");
  if (!dir || !fs.existsSync(path.join(dir, "posts"))) {
    console.error("用法：npx tsx --conditions=react-server scripts/import-wp-knowledge.ts --dir <資料夾> [--apply] [--allow-remote]");
    process.exit(1);
  }
  if (apply && !isLocalDb(process.env.DATABASE_URL) && !allowRemote) {
    console.error("DATABASE_URL 不是 localhost；要寫入遠端資料庫請明確加 --allow-remote");
    process.exit(1);
  }
  const { posts, excluded, media, mediaMap } = loadExport(dir);
  if (!mediaMap) console.warn(`⚠ 找不到 ${path.join(dir, MEDIA_MAP_FILE)}：圖片／音訊會維持舊站 CDN 網址（先跑 scripts/mirror-wp-media.ts）`);
  const converted = [...posts.values()].map((p) => convertPost(p, media, mediaMap));
  const byCategory: Record<string, number> = {};
  let noCategory = 0, noCover = 0, publicCount = 0, iframes = 0, oldCdnLeft = 0;
  for (const c of converted) {
    const cat = c.tags.find((t) => KNOWLEDGE_CATEGORIES.some((k) => k.name === t && k.slug !== "free"));
    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1; else noCategory += 1;
    if (!c.coverImage) noCover += 1;
    if (c.visibility === "PUBLIC") publicCount += 1;
    iframes += (c.contentHtml.match(/<iframe/g) ?? []).length;
    if (c.contentHtml.includes(OLD_CDN_HOST) || c.coverImage?.includes(OLD_CDN_HOST)) oldCdnLeft += 1;
  }
  console.log({ posts: converted.length, excluded: excluded.length, byCategory, noCategory, noCover, publicCount, iframesKept: iframes, mediaMapped: mediaMap?.size ?? 0, postsStillOnOldCdn: oldCdnLeft, mode: apply ? "APPLY" : "dry-run" });
  const sample = converted.find((c) => c.tags.includes("晨間小語"));
  if (sample) console.log("sample:", { title: sample.title, summary: sample.summary, tags: sample.tags, cover: sample.coverImage, htmlHead: sample.contentHtml.slice(0, 200) });
  if (!apply) return;

  const removed = await prisma.knowledgeArticle.deleteMany({ where: { wpId: { in: excluded.map((p) => p.id) } } });
  if (removed.count) console.log(`已刪除先前匯入的排除分類文章：${removed.count} 篇`);
  let done = 0;
  const queue = [...converted];
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const { wpId, ...rest } = c;
      try {
        await prisma.knowledgeArticle.upsert({
          where: { wpId },
          create: { wpId, ...rest },
          update: rest,
        });
      } catch (e) {
        console.error(`寫入失敗 wpId=${wpId}「${c.title}」：`, e instanceof Error ? e.message.split("\n").slice(-3).join(" ") : e);
        throw e;
      }
      done += 1;
      if (done % 200 === 0) console.log(`…${done}/${converted.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const total = await prisma.knowledgeArticle.count({ where: { wpId: { not: null } } });
  console.log({ upserted: done, inDb: total });
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
