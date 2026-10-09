/* 一次性講義搬檔。預設 --dry-run；--apply 只允許本機 DB 與本機 Storage。
 * 正式環境的資料搬遷須由 PM 另外決定流程，不能拿本腳本直接對正式站執行。 */
import { prisma } from "../src/lib/db";
import {
  COURSE_MATERIALS_BUCKET,
  createAdminClient,
  ensureMaterialsBucket,
} from "../src/lib/supabase/admin";

const PUBLIC_PATH = "/storage/v1/object/public/course-assets/materials/";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.some((arg) => arg !== "--apply" && arg !== "--dry-run") ||
    (apply && args.includes("--dry-run"))) {
  console.error("用法：npx tsx --conditions=react-server scripts/migrate-materials-to-private.ts [--dry-run|--apply]");
  process.exit(1);
}

function localHost(raw: string | undefined): boolean {
  try {
    return !!raw && ["localhost", "127.0.0.1"].includes(new URL(raw).hostname);
  } catch {
    return false;
  }
}

if (!localHost(process.env.DATABASE_URL)) {
  console.error("DATABASE_URL 不是 localhost，拒絕執行");
  process.exit(1);
}
if (apply && !localHost(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("--apply 只允許本機 Supabase Storage；正式搬遷由 PM 另行決定");
  process.exit(1);
}

async function main() {
  const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const rows = await prisma.courseMaterial.findMany({
    where: { storagePath: null, url: { contains: PUBLIC_PATH } },
    select: { id: true, title: true, url: true },
    orderBy: { createdAt: "asc" },
  });
  const pending = rows.flatMap((row) => {
    if (!row.url) return [];
    try {
      const url = new URL(row.url);
      if (url.origin !== storageOrigin || !url.pathname.startsWith(PUBLIC_PATH)) return [];
      const path = `materials/${decodeURIComponent(url.pathname.slice(PUBLIC_PATH.length))}`;
      return path === "materials/" ? [] : [{ ...row, path }];
    } catch {
      return [];
    }
  });
  console.log(`${apply ? "APPLY" : "DRY-RUN"}：待搬講義 ${pending.length} 筆`);
  for (const row of pending) console.log(`  ${row.id} ${row.path} ${row.title}`);
  if (!apply || pending.length === 0) return;

  await ensureMaterialsBucket();
  const storage = createAdminClient().storage;
  let moved = 0;
  for (const row of pending) {
    const { data: file, error: downloadError } = await storage.from("course-assets").download(row.path);
    if (downloadError || !file) throw new Error(`下載 ${row.path} 失敗：${downloadError?.message ?? "無資料"}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await storage.from(COURSE_MATERIALS_BUCKET).upload(row.path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw new Error(`私有 bucket 上傳 ${row.path} 失敗：${uploadError.message}`);

    const updated = await prisma.courseMaterial.updateMany({
      where: { id: row.id, storagePath: null, url: row.url },
      data: { storagePath: row.path, url: null },
    });
    if (updated.count !== 1) {
      await storage.from(COURSE_MATERIALS_BUCKET).remove([row.path]);
      throw new Error(`講義 ${row.id} 已被其他程序修改，停止搬遷`);
    }
    const { error: removeError } = await storage.from("course-assets").remove([row.path]);
    if (removeError) throw new Error(`已切私有講義但刪公開物件 ${row.path} 失敗：${removeError.message}`);
    moved++;
  }
  console.log(`完成：${moved} 筆`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
