import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 伺服器端 Supabase client（server component / server action / route handler 用）
// 每個 request 重新建立，不可快取成模組層單例
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 在 server component 呼叫 set 會丟錯——
            // 只要 proxy 有跑 updateSession 刷新 cookie，這裡可以安全忽略
          }
        },
      },
    }
  );
}

// 目前登入的使用者（取代原本的 `await auth()`）
// 用 getClaims() 在本地驗 JWT，比 getUser() 少一次 Auth API 來回
export async function getAuthUser(): Promise<{
  id: string;
  email: string | null;
  displayName: string | null;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  const metadata = data.claims.user_metadata as
    | { display_name?: string }
    | undefined;

  return {
    id: data.claims.sub,
    email: (data.claims.email as string | undefined) ?? null,
    displayName: metadata?.display_name ?? null,
  };
}
