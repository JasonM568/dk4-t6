"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateInviteCode, redeemInvite } from "@/lib/zone-invite";
import { autoEnrollOnRegister } from "@/lib/zone-enroll";
import { claimStudentRecord } from "@/lib/student-history";
import { claimPendingEnrollments } from "@/lib/pending-enroll";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/course-access";
import { explainMobile } from "@/lib/sms/phone";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { getAuthUser } from "@/lib/supabase/server";

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

// 規則對齊 hope 站：密碼至少 6 字元；姓名開放中英文（2026-06-12 放寬，原本僅限中文）
const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .regex(
      /^[一-鿿A-Za-z][一-鿿A-Za-z\s.·'-]*[一-鿿A-Za-z.]$/,
      "姓名請輸入至少 2 個字（中文或英文）",
    ),
  email: z.string().email("Email 格式不正確"),
  password: z.string().min(6, "密碼至少 6 字元"),
});

/** 手機驗證（2026-08-15 起必填）：normalizeMobile 同一套規則，
 *  拒絕理由轉成表單看得懂的訊息。
 *
 *  海外會員（2026-08-23 起）：帶國碼的號碼一律放行，存 E.164（+60123456789）。
 *  在此之前只認 09 開頭 10 碼，海外會員填不出來就過不了 /complete-profile 閘門，
 *  等於被鎖在整個會員區外面（連買過的課都看不到）——而他們唯一的自救方式是
 *  亂填一個台灣號碼，那筆資料會進簡訊名單、真的寄到某個陌生人手機上。
 *  海外門號的上課通知走 Email；簡訊端 normalizeMobile 會自然跳過，不會誤寄國際簡訊。
 *
 *  沒帶國碼的輸入驗證規則完全不變——打錯的台灣號碼照樣被擋。 */
function parsePhoneField(raw: unknown): { phone?: string; error?: string } {
  const r = explainMobile(raw);
  if (r.mobile) return { phone: r.mobile };
  if (r.overseas) return { phone: r.overseas };
  switch (r.reject) {
    case "EMPTY":
      return { error: "請填寫手機號碼" };
    case "LANDLINE":
      return { error: "請填寫行動電話（市話收不到簡訊通知）" };
    case "TOO_SHORT":
    case "TOO_LONG":
    case "FORMAT":
    default:
      return {
        error:
          "手機號碼格式不正確，請輸入 09 開頭的 10 碼號碼；海外門號請加國碼，例如 +60123456789",
      };
  }
}

/** 個資同意 checkbox（必勾）＋手機的共同驗證，註冊與補填共用 */
function parseProfileFields(formData: FormData): {
  phone?: string;
  name?: string;
  error?: string;
} {
  if (formData.get("privacyConsent") !== "on") {
    return { error: "請閱讀並勾選同意個人資料蒐集告知事項" };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "請填寫姓名（訂單與發票需要）" };
  if (name.length > 50) return { error: "姓名長度過長" };
  const phone = parsePhoneField(formData.get("phone"));
  if (phone.error) return phone;
  return { ...phone, name };
}

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
      return "此帳號尚未完成 Email 驗證，請先點擊認證信中的連結完成驗證（找不到信請檢查垃圾信件匣）";
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
  const { data: signInData, error } =
    await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: mapAuthError(error.code, error.status) };
  }

  // 邀請碼註冊的專區會員：登入後直接進所屬企業專區（多個專區取最近加入的）
  const zoneMember = await prisma.courseGroupMember
    .findFirst({
      where: {
        email: normalizeEmail(parsed.data.email),
        source: "INVITE",
        group: { isActive: true },
      },
      orderBy: { createdAt: "desc" },
      select: { group: { select: { slug: true } } },
    })
    .catch(() => null); // 導向查詢失敗不擋登入

  const dest = zoneMember ? `/zone/${zoneMember.group.slug}` : "/dashboard";

  // 2026-08-15 起手機必填：既有會員沒補過 → 先去補填頁（補完自動回 dest）。
  // 查詢失敗 fail-open 不擋登入（合規閘門非安全邊界）
  if (signInData.user) {
    // 補齊定義＝有手機「且」有同意（訂單回填列只有手機、同意 null，仍要走補填頁勾同意）
    const row = await prisma.memberProfile
      .findUnique({
        where: { userId: signInData.user.id },
        select: { privacyConsentAt: true },
      })
      .catch(() => ({ privacyConsentAt: new Date(0) })); // fail-open
    if (!row?.privacyConsentAt) {
      redirect(`/complete-profile?next=${encodeURIComponent(dest)}`);
    }
  }

  redirect(dest);
}

export type CompleteProfileState = { error?: string } | null;

/** 既有會員補填手機＋個資同意（/complete-profile 與會員資料頁共用）。
 *  補填後導回 next（僅接受站內路徑，防 open redirect）。 */
export async function completeProfileAction(
  _prev: CompleteProfileState,
  formData: FormData,
): Promise<CompleteProfileState> {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const fields = parseProfileFields(formData);
  if (fields.error) return { error: fields.error };

  await prisma.memberProfile.upsert({
    where: { userId: user.id },
    update: {
      name: fields.name!,
      phone: fields.phone!,
      privacyConsentAt: new Date(),
      privacyConsentVersion: PRIVACY_POLICY_VERSION,
    },
    create: {
      userId: user.id,
      name: fields.name!,
      phone: fields.phone!,
      privacyConsentAt: new Date(),
      privacyConsentVersion: PRIVACY_POLICY_VERSION,
    },
  });

  const nextRaw = String(formData.get("next") ?? "");
  redirect(/^\/(?!\/)/.test(nextRaw) ? nextRaw : "/dashboard");
}

/** 會員資料頁更新手機（已同意過條款者；同意紀錄不變） */
export async function updatePhoneAction(
  _prev: CompleteProfileState,
  formData: FormData,
): Promise<CompleteProfileState> {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = parsePhoneField(formData.get("phone"));
  if (parsed.error) return { error: parsed.error };

  const updated = await prisma.memberProfile
    .updateMany({ where: { userId: user.id }, data: { phone: parsed.phone! } })
    .catch(() => ({ count: 0 }));
  if (updated.count === 0) {
    // 還沒有同意紀錄（理論上會被閘門擋在前面）：導去完整補填流程
    redirect("/complete-profile?next=%2Fdashboard%2Fprofile");
  }
  redirect("/dashboard/profile?updated=1");
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

  // 手機必填＋個資同意必勾（2026-08-15 起）：先驗完才建帳號
  const profileFields = parseProfileFields(formData);
  if (profileFields.error) return { error: profileFields.error };
  const phone = profileFields.phone!;

  // 企業專區邀請碼（選填）：先驗證再建帳號，碼無效就不註冊，
  // 避免使用者以為拿到專區身分卻沒有
  const inviteRaw = String(formData.get("invite") ?? "").trim();
  let invite = null;
  if (inviteRaw) {
    const result = await validateInviteCode(inviteRaw);
    if (!result.ok) return { error: result.error };
    invite = result.invite;
  }

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
      // 專案開啟 Confirm email 時，確認連結導回本站 /auth/confirm
      //（token_hash/type/next 由信件模板附上，這裡不能帶 query string）
      emailRedirectTo: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info"}/auth/confirm`,
    },
  });

  if (error) {
    return { error: mapAuthError(error.code, error.status) };
  }

  // 已註冊過的 email：signUp 不報錯但回傳 identities 為空陣列
  if (data.user && data.user.identities?.length === 0) {
    return {
      error: invite
        ? "此 Email 已被註冊。請直接登入，再到專區頁輸入邀請碼即可加入專區"
        : "此 Email 已被註冊，請直接登入或使用忘記密碼",
    };
  }

  // 手機＋個資同意紀錄：帳號建立成功即寫入（Confirm email 前寫入也沒關係，
  // 以 userId 為鍵）。寫入失敗不擋註冊——登入閘門會再要求補填，記 log 即可。
  if (data.user) {
    try {
      await prisma.memberProfile.upsert({
        where: { userId: data.user.id },
        update: {
          phone,
          privacyConsentAt: new Date(),
          privacyConsentVersion: PRIVACY_POLICY_VERSION,
        },
        create: {
          userId: data.user.id,
          phone,
          privacyConsentAt: new Date(),
          privacyConsentVersion: PRIVACY_POLICY_VERSION,
        },
      });
    } catch (e) {
      console.error("[register] MemberProfile 寫入失敗（登入時會要求補填）", { email, e });
    }
  }

  // 帶邀請碼註冊：帳號建立成功後立刻寫入專區會籍（以 email 為鍵，
  // 不受 Confirm email 時序影響——確認信箱、登入後身分即生效）。
  // 會籍寫入失敗不影響註冊結果，記 log 供後台補救。
  if (invite && data.user) {
    try {
      await redeemInvite(invite, email, {
        name: displayName,
        userId: data.user.id,
      });
    } catch (e) {
      console.error("[register] 邀請碼會籍寫入失敗", { email, code: invite.code, e });
    }
  }

  // 不帶邀請碼但 email 已在專區名單（後台先匯入）：回填 userId ＋ 期限內課程自動開通。
  // 失敗不影響註冊結果，記 log 供後台補救。
  if (data.user) {
    try {
      await autoEnrollOnRegister(email, data.user.id);
    } catch (e) {
      console.error("[register] 專區自動開通失敗", { email, e });
    }
    // email 在待開通名單（批次開通時查無會員的存底）→ 註冊當下自動認領開通
    try {
      await claimPendingEnrollments(email, data.user.id);
    } catch (e) {
      console.error("[register] 待開通認領失敗", { email, e });
    }
    try {
      await claimStudentRecord(data.user.id, { email, phone });
    } catch (e) {
      console.error("[register] 歷史學員資料認領失敗", { email, e });
    }
  }

  // 專案若開啟 Confirm email，signUp 不會建立 session → 提示收信
  if (!data.session) {
    return {
      success: true,
      message: invite
        ? `註冊成功，已加入「${invite.groupName}」！請到信箱收取確認信，完成驗證後即可登入。`
        : "註冊成功！請到信箱收取確認信，完成驗證後即可登入。",
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
      redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info"}/auth/confirm`,
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

// ───────────────────────── 電子報退訂（公開，不需登入）─────────────────────────

/** 退訂電子報：服務端重驗 HMAC token（不能信 client），upsert 冪等 */
export async function unsubscribeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { verifyUnsubscribeToken, normalizeEmail } = await import(
    "@/lib/email/unsubscribe"
  );
  const { prisma } = await import("@/lib/db");

  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (!verifyUnsubscribeToken(email, token)) {
    return { error: "退訂連結無效，請使用信件中的「取消訂閱」連結" };
  }

  const normalized = normalizeEmail(email);
  await prisma.mailUnsubscribe.upsert({
    where: { email: normalized },
    create: { email: normalized, reason: reason || null },
    // 重複退訂：不動 source/createdAt，只補使用者這次填的原因
    update: reason ? { reason } : {},
  });
  redirect("/unsubscribe?done=1");
}
