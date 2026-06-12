import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// 信件連結落點：{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
// token_hash + verifyOtp 不依賴 PKCE code verifier → 跨裝置/瀏覽器開信也能用
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/reset-password";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      // 驗證成功，session cookie 已寫入 → 帶去設定新密碼
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // token 缺漏/過期/已使用 → 回忘記密碼頁重新申請
  return NextResponse.redirect(
    new URL("/forgot-password?error=invalid_or_expired", request.url),
  );
}
