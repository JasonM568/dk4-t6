import "server-only";

import { getBoardClientIp } from "@/lib/board-auth";
import { reserveLoginAttempt } from "@/lib/login-throttle";

// 公開表單每次有效送出都計一次：同 IP 10 分鐘 20 次、跨 IP 全站 300 次。
// 超限後同 IP 鎖 15 分鐘，全站鎖 10 分鐘；每張表單各自計數。
const WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
// Jason 2026-10-09：講座現場幾十人共用同一個 WiFi 掃碼索取資料／報名，同 IP 20 次會擋到真人；
// 這三張表單放寬到 60（全站 300 不動）。其餘（註冊、忘記密碼、企業包班）維持 20。
const IP_MAX_ATTEMPTS_BY_FORM: Record<string, number> = {
  webinar: 60,
  "session-signup": 60,
  "session-checkout": 60,
};
export function ipMaxAttemptsFor(form: string): number {
  return IP_MAX_ATTEMPTS_BY_FORM[form] ?? IP_MAX_ATTEMPTS;
}
const IP_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_MAX_ATTEMPTS = 300;
const GLOBAL_LOCK_MS = 10 * 60 * 1000;

export const FORM_THROTTLE_ERROR = "操作過於頻繁，請 15 分鐘後再試";

export async function reserveFormAttempt(form: string, ip: string): Promise<boolean> {
  const ipLocked = await reserveLoginAttempt(
    `form:${form}:ip:${ip}`, WINDOW_MS, ipMaxAttemptsFor(form), IP_LOCK_MS,
  );
  const globalLocked = await reserveLoginAttempt(
    `form:${form}:global`, WINDOW_MS, GLOBAL_MAX_ATTEMPTS, GLOBAL_LOCK_MS,
  );
  return ipLocked || globalLocked;
}

export async function reserveCurrentFormAttempt(form: string): Promise<boolean> {
  // 直接呼叫 action 的本機測試沒有 request context；取不到 IP 時共用一個額度，仍限流。
  const ip = await getBoardClientIp().catch(() => "unknown");
  return reserveFormAttempt(form, ip);
}
