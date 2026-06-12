import "server-only";
import { createClient } from "@supabase/supabase-js";

// Admin client：用 SUPABASE_SECRET_KEY（BYPASSRLS），只能在 server 端使用。
// 本檔案以 `import "server-only"` 防止被打包進 client bundle。
// 用途僅限「唯讀」查詢 QBC 管的 public.profiles——絕不對 public schema 寫入。

// public.profiles 的型別（QBC 站的 handle_new_user trigger 建立）
export type Profile = {
  id: string; // auth.users.id（uuid）
  email: string | null;
  display_name: string | null;
  nickname: string | null;
  role: string | null; // student | admin | coach | master | tester
};

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        // 純 server 端查詢用，不需要 session 機制
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// 查單一使用者的 role（admin layout / requireAdmin 二次驗證用）
export async function getProfileRole(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[supabase/admin] 查詢 profiles.role 失敗：", error.message);
    return null;
  }
  return data?.role ?? null;
}

// 後台總覽用：唯讀計算 profiles 總數（head:true 只回 count 不抓資料）
export async function countProfiles(): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[supabase/admin] 計算 profiles 總數失敗：", error.message);
    return 0;
  }
  return count ?? 0;
}

// 後台會員列表用：唯讀撈出全部 profiles
export async function listProfiles(): Promise<Profile[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, nickname, role")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[supabase/admin] 查詢 profiles 列表失敗：", error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}
