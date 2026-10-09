import "server-only";

import { getBoardClientIp } from "@/lib/board-auth";
import { reserveLoginAttempt } from "@/lib/login-throttle";

// 公開表單每次有效送出都計一次：同 IP 10 分鐘 20 次、跨 IP 全站 300 次。
// 超限後同 IP 鎖 15 分鐘，全站鎖 10 分鐘；每張表單各自計數。
const WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
const IP_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_MAX_ATTEMPTS = 300;
const GLOBAL_LOCK_MS = 10 * 60 * 1000;

export const FORM_THROTTLE_ERROR = "操作過於頻繁，請 15 分鐘後再試";

export async function reserveFormAttempt(form: string, ip: string): Promise<boolean> {
  const ipLocked = await reserveLoginAttempt(
    `form:${form}:ip:${ip}`, WINDOW_MS, IP_MAX_ATTEMPTS, IP_LOCK_MS,
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
