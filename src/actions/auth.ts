"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = {
  error?: string;
  success?: boolean;
  message?: string; // 成功但需額外提示時用（如：請收確認信）
};

export type ForgotPasswordState = ActionState & {
  email?: string; // 回填使用者輸入的 email（重寄時沿用）
  retryAfter?: number; // 鎖鈕秒數：429 時讀伺服器建議值，寄出成功時為 60
  sentAt?: number; // 本次回應的時間戳（前端據此推算倒數終點）
};

// 規則對齊 hope 站：密碼至少 6 字元；display_name 至少 2 個中文字
const registerSchema = z.object({
  displayName: z
    .string()
    .regex(/^[一-鿿]{2,}$/, "姓名請輸入至少 2 個中文字"),
  email: z.string().email("Email 格式不正確"),
  password: z.string().min(6, "密碼至少 6 字元"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Email 格式不正確"),
});

const loginSchema = z.object({
  email: z.string().email("Email 格式不正確"),
  password: z.string().min(1, "請輸入密碼"),
});

// 把 Supabase Auth 錯誤對應成使用者可讀的繁中文案（不外洩原始錯誤）
function mapAuthError(code: string | undefined, status?: number): string {
  switch (code) {
    case "invalid_credentials":
      return "Email 或密碼錯誤";
    case "email_not_confirmed":
      return "此帳號尚未完成 Email 驗證，請先到信箱收取確認信";
    case "user_banned":
      return "此帳號已被停用，請聯繫客服";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "操作太頻繁，請稍後再試";
    case "email_address_invalid":
      return "Email 格式不正確";
    case "weak_password":
      return "密碼強度不足，請至少使用 6 字元";
    case "signup_disabled":
      return "目前暫停開放註冊，請聯繫客服";
    default:
      if (status === 429) return "操作太頻繁，請稍後再試";
      return "系統發生錯誤，請稍後再試";
  }
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入有誤" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: mapAuthError(error.code, error.status) };
  }

  redirect("/dashboard");
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入有誤" };
  }

  const { displayName, email, password } = parsed.data;

  // metadata 對齊 hope 站，讓 QBC 的 handle_new_user trigger 建出一致的 profiles
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        nickname: displayName,
        role: "student",
      },
    },
  });

  if (error) {
    return { error: mapAuthError(error.code, error.status) };
  }

  // 已註冊過的 email：signUp 不報錯但回傳 identities 為空陣列
  if (data.user && data.user.identities?.length === 0) {
    return { error: "此 Email 已被註冊，請直接登入或使用忘記密碼" };
  }

  // 專案若開啟 Confirm email，signUp 不會建立 session → 提示收信
  if (!data.session) {
    return {
      success: true,
      message: "註冊成功！請到信箱收取確認信，完成驗證後即可登入。",
    };
  }

  redirect("/dashboard");
}

// 從 Supabase 429 錯誤推算建議等待秒數：
// supabase-js 不直接暴露 Retry-After header，但 GoTrue 會把秒數寫進
// 錯誤訊息（如 "you can only request this after 53 seconds"），這裡解析它；
// 解析不到時退回 60 秒（Supabase 同一使用者預設冷卻期）
function parseRetryAfterSeconds(message: string | undefined): number {
  const match = message?.match(/after (\d+) seconds?/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入有誤" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      // 信件模板的 {{ .RedirectTo }} 會帶到這裡；token_hash 由模板自己拼上
      redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/auth/confirm`,
    },
  );

  if (error) {
    // rate limit：回報建議等待秒數，讓前端鎖鈕倒數
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      const retryAfter = parseRetryAfterSeconds(error.message);
      return {
        error: `操作太頻繁，請於 ${retryAfter} 秒後再試`,
        retryAfter,
        sentAt: Date.now(),
        email: parsed.data.email,
      };
    }
    // 其他錯誤（含 email 不存在）一律回成功文案——防帳號枚舉
    console.error("[forgotPasswordAction]", error.code, error.status);
  }

  // 寄出成功：鎖 60 秒（對齊 Supabase 同一使用者冷卻期）
  return {
    success: true,
    retryAfter: 60,
    sentAt: Date.now(),
    email: parsed.data.email,
  };
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
