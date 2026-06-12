import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 需要登入才能訪問的路徑前綴（與 src/proxy.ts 的 matcher 清單一致）
// proxy 層只驗「已登入」；admin 角色由 (admin)/layout 的 requireAdmin 二次驗證
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/orders",
  "/my-courses",
  "/learn",
  "/admin",
];

// 給 src/proxy.ts 用的 session 刷新 helper：
// 1. 刷新過期的 auth cookie（寫回 request 與 response 雙邊）
// 2. 未登入訪問保護路徑時導向 /login
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 重要：createServerClient 之後、任何其他邏輯之前必須先呼叫 getClaims()，
  // 否則 token 刷新不會發生，使用者會被隨機登出
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = !!data?.claims;

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!isLoggedIn && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 重要：必須原樣回傳 supabaseResponse（帶剛刷新的 cookie），
  // 若要自建 response，務必複製 supabaseResponse.cookies，否則 session 會斷
  return supabaseResponse;
}
