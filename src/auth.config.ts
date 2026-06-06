import type { NextAuthConfig } from "next-auth";

// 受保護的會員區路徑前綴
const MEMBER_PREFIXES = ["/dashboard", "/orders", "/my-courses", "/learn"];

/**
 * Edge-safe 設定：只放 pages 與 callbacks，不 import prisma / bcrypt。
 * middleware 會用這份設定建立輕量 auth 實例。
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [], // 真正的 providers 在 auth.ts 注入（含 node 依賴）
  callbacks: {
    // 路由保護（在 middleware 執行）
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname;
      const isLoggedIn = !!auth?.user;
      const role = auth?.user?.role;

      const isAdminArea = path.startsWith("/admin");
      const isMemberArea = MEMBER_PREFIXES.some((p) => path.startsWith(p));

      if (!isAdminArea && !isMemberArea) return true; // public
      if (!isLoggedIn) return false; // → 導向 /login
      if (isAdminArea && role !== "ADMIN") {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    // 只讀 user 物件，不查 DB，保持 edge-safe
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "USER";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "USER" | "ADMIN") ?? "USER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
