import "server-only";

import { prisma } from "@/lib/db";

// 註冊嘗試的結果代碼。放 lib 而不是 actions：`"use server"` 檔案不能匯出常數，
// 而後台監控板（server component）與 action 兩邊都要用同一份定義。
export const REGISTER_REASON = {
  SUCCESS: "SUCCESS",
  /** 姓名／Email／密碼的基本格式（zod） */
  SCHEMA: "SCHEMA",
  /** 沒勾個資同意 */
  CONSENT: "CONSENT",
  /** 姓名沒填或過長 —— 2026-08-29 的 14 天當機就是整批卡在這一類 */
  NAME: "NAME",
  /** 手機沒填或格式不符 */
  PHONE: "PHONE",
  /** 專區邀請碼無效 */
  INVITE: "INVITE",
  /** 這個 Email 已經註冊過（使用者該去登入／忘記密碼，不是系統壞了） */
  EMAIL_TAKEN: "EMAIL_TAKEN",
  /** Supabase Auth 回錯（含流量限制、弱密碼、停止註冊等） */
  AUTH: "AUTH",
} as const;

export type RegisterReason =
  (typeof REGISTER_REASON)[keyof typeof REGISTER_REASON];

/** 後台顯示用中文標籤 */
export const REGISTER_REASON_LABEL: Record<string, string> = {
  SUCCESS: "註冊成功",
  SCHEMA: "姓名／Email／密碼格式",
  CONSENT: "未勾個資同意",
  NAME: "姓名沒填或過長",
  PHONE: "手機格式",
  INVITE: "邀請碼無效",
  EMAIL_TAKEN: "Email 已註冊過",
  AUTH: "Supabase 回錯",
};

/** 這些原因屬於「使用者自己的狀況」，不代表系統壞掉。
 *  監控板用它把雜訊和真正的警訊分開——一個人打錯手機不值得緊張，
 *  但整批人卡在 NAME 就是 2026-08-29 那種事故。 */
const USER_SIDE: ReadonlySet<string> = new Set([
  REGISTER_REASON.EMAIL_TAKEN,
  REGISTER_REASON.INVITE,
]);

export function isUserSideReason(reason: string): boolean {
  return USER_SIDE.has(reason);
}

/** 紀錄一次註冊嘗試。
 *
 *  成功時刻意不存 email／姓名／手機：Supabase 帳號表已經有了，這裡只需要時間軸
 *  來回答「最後一次有人註冊成功是什麼時候」。失敗才存聯絡方式，因為那正是
 *  「把卡住的人找回來」的用途。任何情況都不存密碼。
 *
 *  寫入失敗絕不能影響註冊本身——監控是附加價值，不是必要路徑。 */
export async function logRegisterAttempt(input: {
  reason: RegisterReason;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  detail?: string | null;
}): Promise<void> {
  const success = input.reason === REGISTER_REASON.SUCCESS;
  try {
    await prisma.registerAttempt.create({
      data: {
        reason: input.reason,
        email: success ? null : (input.email?.trim().toLowerCase() || null),
        name: success ? null : (input.name?.trim() || null),
        phone: success ? null : (input.phone?.trim() || null),
        detail: input.detail?.slice(0, 300) || null,
      },
    });
  } catch (e) {
    console.error("[register-log] 寫入註冊嘗試紀錄失敗（不影響註冊）", e);
  }
}

/** 個資保存期限：90 天。查案夠用，又不會無限囤積聯絡方式。 */
export const REGISTER_ATTEMPT_RETENTION_DAYS = 90;

/** 清掉超過保存期限的紀錄（由 cron 每日呼叫一次）。回傳刪除筆數。 */
export async function purgeOldRegisterAttempts(): Promise<number> {
  const cutoff = new Date(
    Date.now() - REGISTER_ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const r = await prisma.registerAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return r.count;
}
