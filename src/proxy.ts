import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// 用 edge-safe 的 authConfig 建立輕量 auth 實例做路由保護
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/orders/:path*",
    "/my-courses/:path*",
    "/learn/:path*",
    "/admin/:path*",
  ],
};
