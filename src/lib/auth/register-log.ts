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

/** 多久沒有人註冊成功就該當成事故。
 *  2026-08-29 那次壞了 14 天沒人發現；平常每天 2–3 人註冊，
 *  連 3 天掛零已經明顯不對勁了。 */
export const SILENT_DAYS_WARN = 3;

/** 監控板最重要的一格：距離上次成功註冊幾天、要不要轉紅字。
 *
 *  抽成純函式是因為這條分支正是板子存在的理由，卻最不容易在正式站
 *  被自然觸發到——不能用「等它真的壞掉」來驗證告警會不會亮。
 *
 *  lastSuccessAt 為 null（表剛上線、還沒有任何成功紀錄）時不報警：
 *  拿「查無資料」當事故會在上線當天就叫一次狼來了。 */
export function registerSilence(
  lastSuccessAt: Date | null,
  now: Date = new Date(),
): { daysSilent: number | null; alarm: boolean } {
  if (!lastSuccessAt) return { daysSilent: null, alarm: false };
  const days = Math.floor(
    (now.getTime() - lastSuccessAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  const daysSilent = Math.max(0, days); // 時鐘誤差造成的未來時間不該算成負數
  return { daysSilent, alarm: daysSilent >= SILENT_DAYS_WARN };
}
