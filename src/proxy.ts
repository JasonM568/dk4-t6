import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16 proxy（Node runtime）：刷新 Supabase session cookie + 保護路由。
// 只驗「已登入」；admin 角色由 (admin)/layout 的 requireAdmin 二次驗證。
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/orders/:path*",
    "/my-courses/:path*",
    "/learn/:path*",
    "/admin/:path*",
  ],
};
