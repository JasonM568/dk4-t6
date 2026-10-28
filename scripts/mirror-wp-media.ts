/* 舊官網文章用到的圖片／音訊／PDF → Supabase Storage（course-assets 公開 bucket，knowledge/wp/ 前綴）。
 *
 *   npx tsx --conditions=react-server scripts/mirror-wp-media.ts --dir <資料夾> [--apply] [--concurrency 8]
 *
 * 只處理 import-wp-knowledge.ts 會匯入的文章（排除新聞速報），來源網址由 collectMediaUrls 決定。
 * 產出 <資料夾>/media-map.json｛舊網址 → Storage 公開網址｝，匯入腳本讀它改寫內文與封面；
 * 抓不到或 MIME 不允許的寫進 media-map-failed.json，匯入時維持原網址，不中斷。
 * 冪等：已在對照表裡的網址跳過（要重抓就刪掉對照表那一筆），Storage 端 upsert。
 * 預設 dry-run：只 HEAD 統計張數與大小，不下載不上傳。
 * 需要 .env 的 SUPABASE_SECRET_KEY（set -a; source .env; set +a）。 */
import fs from "node:fs";
import path from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import { MEDIA_MAP_FILE, MIRROR_MIME_EXT, collectMediaUrls, loadExport, storageKeyFor } from "./import-wp-knowledge";

const BUCKET = "course-assets";
const ALLOWED = MIRROR_MIME_EXT;

type Result = { url: string; key?: string; publicUrl?: string; bytes: number; error?: string };

async function fetchOne(url: string, method: "HEAD" | "GET"): Promise<{ ok: boolean; status: number; type: string; bytes: number; body?: Buffer }> {
  const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(60_000), headers: { "user-agent": "Mozilla/5.0 (course-platform mirror)" } });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (method === "HEAD") return { ok: res.ok, status: res.status, type, bytes: Number(res.headers.get("content-length") ?? 0) };
  const body = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, type, bytes: body.length, body };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : "";
  const apply = args.includes("--apply");
  const cIdx = args.indexOf("--concurrency");
  const concurrency = cIdx >= 0 ? Math.max(1, Number(args[cIdx + 1]) || 8) : 8;
  if (!dir || !fs.existsSync(path.join(dir, "posts"))) {
    console.error("用法：npx tsx --conditions=react-server scripts/mirror-wp-media.ts --dir <資料夾> [--apply] [--concurrency 8]");
    process.exit(1);
  }
  const { posts, excluded, media, mediaMap } = loadExport(dir);
  const urls = new Set<string>();
  for (const p of posts.values()) for (const u of collectMediaUrls(p, media)) urls.add(u);
  const map: Record<string, string> = Object.fromEntries(mediaMap ?? []);
  const todo = [...urls].filter((u) => !map[u]).sort();
  console.log({ posts: posts.size, excluded: excluded.length, mediaUrls: urls.size, alreadyMapped: urls.size - todo.length, todo: todo.length, mode: apply ? "APPLY" : "dry-run" });
  if (todo.length === 0) return;

  const supabase = apply ? createAdminClient() : null;
  const mapFile = path.join(dir, MEDIA_MAP_FILE);
  const failFile = path.join(dir, "media-map-failed.json");
  const results: Result[] = [];
  let done = 0;
  const save = () => fs.writeFileSync(mapFile, JSON.stringify(map, null, 1));
  const queue = [...todo];
  async function worker() {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const r: Result = { url, bytes: 0 };
      try {
        if (!supabase) {
          const h = await fetchOne(url, "HEAD");
          r.bytes = h.bytes;
          if (!h.ok) r.error = `HTTP ${h.status}`;
          else if (!ALLOWED[h.type]) r.error = `MIME ${h.type || "?"} 不允許`;
        } else {
          const g = await fetchOne(url, "GET");
          r.bytes = g.bytes;
          if (!g.ok) r.error = `HTTP ${g.status}`;
          else if (!ALLOWED[g.type]) r.error = `MIME ${g.type || "?"} 不允許`;
          else if (g.bytes === 0) r.error = "空檔";
          else {
            const key = storageKeyFor(url, ALLOWED[g.type]);
            const { error } = await supabase.storage.from(BUCKET).upload(key, g.body!, { contentType: g.type, upsert: true, cacheControl: "31536000" });
            if (error) r.error = `上傳失敗：${error.message}`;
            else {
              r.key = key;
              r.publicUrl = supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
              map[url] = r.publicUrl;
            }
          }
        }
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
      }
      results.push(r);
      done += 1;
      if (r.error) console.warn(`✗ ${url} — ${r.error}`);
      if (done % 100 === 0) { console.log(`…${done}/${todo.length}`); if (supabase) save(); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const okRes = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  const byHost: Record<string, { n: number; bytes: number }> = {};
  for (const r of okRes) { const h = new URL(r.url).hostname; byHost[h] ??= { n: 0, bytes: 0 }; byHost[h].n += 1; byHost[h].bytes += r.bytes; }
  console.log({ ok: okRes.length, failed: failed.length, totalSize: mb(okRes.reduce((s, r) => s + r.bytes, 0)), byHost: Object.fromEntries(Object.entries(byHost).map(([h, v]) => [h, `${v.n} 個 ${mb(v.bytes)}`])) });
  if (supabase) {
    save();
    fs.writeFileSync(failFile, JSON.stringify(failed, null, 1));
    console.log(`對照表 ${mapFile}（${Object.keys(map).length} 筆）；失敗清單 ${failFile}（${failed.length} 筆）`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
