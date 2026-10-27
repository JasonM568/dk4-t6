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
 *   - 圖片與音訊仍指向舊站 CDN（35,000 張、約 9.3GB，是否複製另案決定）
 *   - 預設 dry-run 不寫入；DATABASE_URL 非 localhost 時必須加 --allow-remote（正式站匯入要 Jason 點頭）
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { htmlToText, sanitizeArticleHtml } from "../src/lib/article-html";
import { KNOWLEDGE_CATEGORIES, categoryNameFromTitle } from "../src/lib/knowledge-categories";

type WpPost = {
  id: number; date: string; date_gmt?: string | null; modified_gmt?: string; slug: string; status: string; link: string;
  title: { rendered: string; raw?: string }; content: { rendered: string; raw?: string };
  excerpt: { rendered: string; raw?: string }; featured_media: number; categories: number[];
};
type WpMedia = { id: number; source_url: string; alt_text?: string };

const CATEGORY_BY_WP_ID: Record<number, string> = {
  31: "新聞速報", 32: "財經快報", 30: "全球財經", 29: "顧名思易", 34: "晨間小語",
};
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

export type Converted = {
  wpId: number; slug: string; title: string; summary: string; content: string; contentHtml: string;
  coverImage: string | null; tags: string[]; visibility: "PUBLIC" | "SUBSCRIBER"; status: "PUBLISHED";
  publishedAt: Date; sourceUrl: string; images: string[];
};

export function convertPost(p: WpPost, media: Map<number, WpMedia>): Converted {
  const title = stripNul(decodeEntities(p.title.rendered)).trim();
  const fromCategory = p.categories.map((id) => CATEGORY_BY_WP_ID[id]).find(Boolean);
  const category = fromCategory ?? categoryNameFromTitle(title);
  const isFree = p.categories.some((id) => FREE_CATEGORY_IDS.has(id));
  const tags = [...(category ? [category] : []), ...(isFree ? [FREE_TAG] : [])];
  const contentHtml = stripNul(sanitizeArticleHtml(p.content.rendered));
  const text = stripNul(htmlToText(p.content.rendered));
  const summary = text ? truncateSummary(text) : `${category ?? "院長乾貨區"}${/新聞速報/.test(title) ? "：當日新聞圖卡" : ""}`;
  return {
    wpId: p.id,
    slug: `wp-${p.id}`,
    title,
    summary,
    content: text || summary,
    contentHtml,
    coverImage: media.get(p.featured_media)?.source_url ?? null,
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
  const posts = new Map<number, WpPost>();
  for (const f of fs.readdirSync(path.join(dir, "posts")).filter((x) => x.endsWith(".json")).sort()) {
    for (const p of JSON.parse(fs.readFileSync(path.join(dir, "posts", f), "utf8")) as WpPost[]) {
      if (p.status === "publish") posts.set(p.id, p);
    }
  }
  const media = new Map<number, WpMedia>();
  for (const m of JSON.parse(fs.readFileSync(path.join(dir, "media.json"), "utf8")) as WpMedia[]) if (m.id) media.set(m.id, m);

  const converted = [...posts.values()].map((p) => convertPost(p, media));
  const byCategory: Record<string, number> = {};
  let noCategory = 0, noCover = 0, publicCount = 0, iframes = 0;
  for (const c of converted) {
    const cat = c.tags.find((t) => KNOWLEDGE_CATEGORIES.some((k) => k.name === t && k.slug !== "free"));
    if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1; else noCategory += 1;
    if (!c.coverImage) noCover += 1;
    if (c.visibility === "PUBLIC") publicCount += 1;
    iframes += (c.contentHtml.match(/<iframe/g) ?? []).length;
  }
  console.log({ posts: converted.length, byCategory, noCategory, noCover, publicCount, iframesKept: iframes, mode: apply ? "APPLY" : "dry-run" });
  const sample = converted.find((c) => c.tags.includes("晨間小語"));
  if (sample) console.log("sample:", { title: sample.title, summary: sample.summary, tags: sample.tags, cover: sample.coverImage, htmlHead: sample.contentHtml.slice(0, 200) });
  if (!apply) return;

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
