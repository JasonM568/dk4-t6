import "server-only";
import { createClient } from "@supabase/supabase-js";

// Admin client：用 SUPABASE_SECRET_KEY（BYPASSRLS），只能在 server 端使用。
// 本檔案以 `import "server-only"` 防止被打包進 client bundle。
// 用途：
// 1. 「唯讀」查詢 QBC 管的 public.profiles——絕不對 public schema 直接寫入
// 2. 透過 GoTrue Admin API 批次建立會員（profiles 由 QBC 的 handle_new_user trigger 自動建立）

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

// 批次功能用：以 email（小寫）批次查 profiles，回傳 email → Profile 的對照表
export async function getProfilesByEmails(
  emails: string[],
): Promise<Map<string, Profile>> {
  const supabase = createAdminClient();
  const map = new Map<string, Profile>();

  // .in() 一次塞太多會撞 URL 長度限制，分批每 200 筆查一次
  for (let i = 0; i < emails.length; i += 200) {
    const chunk = emails.slice(i, i + 200);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, nickname, role")
      .in("email", chunk);

    if (error) {
      console.error("[supabase/admin] 批次查詢 profiles 失敗：", error.message);
      continue;
    }
    for (const p of (data ?? []) as Profile[]) {
      if (p.email) map.set(p.email.toLowerCase(), p);
    }
  }
  return map;
}

export type CreateMemberResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" | "error"; message?: string };

// 批次匯入用：建立 Supabase Auth 會員。
// metadata 對齊 hope 站註冊（display_name/nickname/role:student），
// 讓 QBC 的 handle_new_user trigger 建出一致的 profiles。
export async function createMember(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<CreateMemberResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true, // 管理員代建，視同已驗證，學員可直接登入
    user_metadata: {
      display_name: input.displayName,
      nickname: input.displayName,
      role: "student",
    },
  });

  if (error) {
    const msg = error.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, reason: "exists" };
    }
    console.error("[supabase/admin] 建立會員失敗：", input.email, msg);
    return { ok: false, reason: "error", message: msg };
  }
  return { ok: true, userId: data.user.id };
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
