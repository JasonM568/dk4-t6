/* 一次性清除：刪掉測試誤建的 Supabase Auth 帳號。
 * 用建立它的同一支 Admin API 刪除（public.profiles 由 QBC trigger CASCADE 處理）。
 * 用法：npx tsx scripts/cleanup-test-user.ts <email> <uuid> */
import { createClient } from "@supabase/supabase-js";

const [, , TARGET_EMAIL, TARGET_ID] = process.argv;
if (!TARGET_EMAIL || !TARGET_ID) {
  console.error("用法：npx tsx scripts/cleanup-test-user.ts <email> <uuid>");
  process.exit(1);
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 保險：確認這個 id 真的是指定的 email，避免刪錯人
  const { data: got, error: getErr } = await supabase.auth.admin.getUserById(TARGET_ID);
  if (getErr) {
    console.error("查詢失敗：", getErr.message);
    process.exit(1);
  }
  if (got.user?.email !== TARGET_EMAIL) {
    console.error(`✗ 中止：id 對應的 email 是 ${got.user?.email}，與指定的不符`);
    process.exit(1);
  }

  const { error } = await supabase.auth.admin.deleteUser(TARGET_ID);
  if (error) {
    console.error("刪除失敗：", error.message);
    process.exit(1);
  }
  console.log(`✓ 已刪除帳號 ${TARGET_EMAIL} (${TARGET_ID})`);
}

main();
