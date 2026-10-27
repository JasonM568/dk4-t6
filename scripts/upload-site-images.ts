/* 把舊官網（academy4hope.com）五個頁面用到的靜態圖片上傳到 Supabase Storage（course-assets 公開 bucket，site/ 前綴）。
 * 一次性搬圖，之後圖片有更新也可以重跑（upsert）。SVG 不在 bucket 允許的 MIME 裡，放 public/site/。
 *
 *   npx tsx --conditions=react-server scripts/upload-site-images.ts <圖片資料夾> [--dry-run]
 *
 * 印出每張圖的公開網址，貼進 src/lib/site-content/*.ts。 */
import fs from "node:fs";
import path from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";

const dir = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!dir || !fs.existsSync(dir)) {
  console.error("用法：npx tsx --conditions=react-server scripts/upload-site-images.ts <圖片資料夾> [--dry-run]");
  process.exit(1);
}

// 本機檔名 → bucket 內路徑
const FILES: Record<string, string> = {
  "lecturers-group.webp": "site/lecturers/group.webp",
  "lecturer-01.webp": "site/lecturers/01.webp",
  "lecturer-02.webp": "site/lecturers/02.webp",
  "lecturer-03.webp": "site/lecturers/03.webp",
  "lecturer-04.webp": "site/lecturers/04.webp",
  "lecturer-05.webp": "site/lecturers/05.webp",
  "lecturer-06.webp": "site/lecturers/06.webp",
  "about-1.webp": "site/about/photo-1.webp",
  "about-2.webp": "site/about/photo-2.webp",
  "about-3.webp": "site/about/photo-3.webp",
  "about-me.webp": "site/about/chancellor.webp",
  "sign.png": "site/about/signature.png",
  "home-about-01.webp": "site/home/photo-1.webp",
  "home-about-02.webp": "site/home/photo-2.webp",
  "home-about-03.webp": "site/home/photo-3.webp",
};
const MIME: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function main() {
  const supabase = createAdminClient();
  for (const [local, remote] of Object.entries(FILES)) {
    const file = path.join(dir, local);
    if (!fs.existsSync(file)) { console.error(`缺檔：${file}`); process.exitCode = 1; continue; }
    const bytes = fs.readFileSync(file);
    const contentType = MIME[path.extname(local).toLowerCase()];
    if (dryRun) { console.log(`[dry-run] ${local} → ${remote} (${bytes.length} bytes)`); continue; }
    const { error } = await supabase.storage.from("course-assets").upload(remote, bytes, { contentType, upsert: true, cacheControl: "31536000" });
    if (error) { console.error(`上傳失敗 ${remote}：${error.message}`); process.exitCode = 1; continue; }
    const { data } = supabase.storage.from("course-assets").getPublicUrl(remote);
    console.log(`${local} → ${data.publicUrl}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
