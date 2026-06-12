import { createBrowserClient } from "@supabase/ssr";

// 瀏覽器端 Supabase client（client component 用，如 reset-password 頁）
// 只用 publishable key，受 RLS 限制
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
