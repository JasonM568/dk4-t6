import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getBoardClientIp } from "@/lib/board-auth";

// 上課連結頁（/live）的 4 位上課碼閘門。
// 與 /board 的差別（刻意不共用同一把鎖）：
//   /board  一組全站碼 → 看得到所有場次的報名名單（工作人員／合作方用）
//   /live   一場一組碼 → 只看得到那一場的會議連結與課程資料（學員用）
// 所以 token 綁 sessionId：拿 A 場的 cookie 換不到 B 場的連結。
//
// cookie 值 = `lv1.${sessionId}.${exp}.${nonce}.${hmac}`
//   hmac = HMAC-SHA256(secret, "live-v1:sessionId:code:exp:nonce")
// 改碼、換 secret、bump 版本或逾時皆立即失效；驗證走 timingSafeEqual。

export const LIVE_COOKIE = "live_auth";
const TOKEN_VERSION = "lv1";
// HMAC 訊息前綴：與 board token 做網域分離，board 的簽章永遠驗不過這裡（反之亦然）
const HMAC_NS = "live-v1";

// 上課碼有效時長：課程當天用得到就好，不需要長期有效
const SESSION_HOURS = 12;

/** 沿用 BOARD_SESSION_SECRET（同一個信任網域、同一批管理員維運），
 *  靠 HMAC_NS 前綴做網域分離而不是靠另一把 secret——多一個必填 env
 *  只會多一個「忘了設就整頁壞掉」的失敗點。
 *  缺漏或過短時安全失敗：不發新 token、既有 cookie 全數驗不過。 */
function liveSecret(): string | null {
  const s = process.env.BOARD_SESSION_SECRET;
  if (!s || s.trim().length < 32) {
    console.error(
      "[live-auth] BOARD_SESSION_SECRET 未設定或長度不足 32 字元，上課連結頁停用",
    );
    return null;
  }
  return s;
}

function sign(
  secret: string,
  sessionId: string,
  code: string,
  expMs: number,
  nonce: string,
): string {
  return createHmac("sha256", secret)
    .update(`${HMAC_NS}:${sessionId}:${code}:${expMs}:${nonce}`)
    .digest("hex");
}

/** 簽發 token；secret 缺漏回 null（呼叫端要擋下並回報設定錯誤） */
export function signLiveToken(sessionId: string, code: string): {
  token: string;
  expMs: number;
} | null {
  const secret = liveSecret();
  if (!secret) return null;
  const expMs = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const nonce = randomBytes(8).toString("hex");
  return {
    token: `${TOKEN_VERSION}.${sessionId}.${expMs}.${nonce}.${sign(secret, sessionId, code, expMs, nonce)}`,
    expMs,
  };
}

/** 驗 token 並回它綁的場次 id 與到期時間；版本/格式/到期/簽章任一不過就 null。
 *  code 一併進簽章：管理員改碼即讓所有既有 cookie 失效。 */
export function verifyLiveToken(
  raw: string,
  lookupCode: (sessionId: string) => string | null,
): { sessionId: string; expiresAt: Date } | null {
  const secret = liveSecret();
  if (!secret) return null;
  const parts = raw.split(".");
  if (parts.length !== 5) return null;
  const [ver, sessionId, expStr, nonce, mac] = parts;
  if (ver !== TOKEN_VERSION) return null;
  if (!/^[a-z0-9]{1,40}$/.test(sessionId)) return null; // cuid 形狀，順帶擋掉注入型輸入
  if (!/^\d{1,15}$/.test(expStr)) return null;
  const expMs = Number(expStr);
  if (expMs <= Date.now()) return null;
  if (!/^[0-9a-f]{16}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return null;

  const code = lookupCode(sessionId);
  if (!code) return null; // 碼被清掉 = 這場不再開放，既有 cookie 一併失效

  const expect = Buffer.from(sign(secret, sessionId, code, expMs, nonce), "hex");
  const given = Buffer.from(mac, "hex");
  if (given.length !== expect.length) return null;
  return timingSafeEqual(given, expect)
    ? { sessionId, expiresAt: new Date(expMs) }
    : null;
}

/** 恆定時間比對上課碼（先雜湊拉平長度差，時序不洩漏正確位數） */
export function liveCodeEquals(input: string, code: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(code).digest();
  return timingSafeEqual(a, b);
}

/** 目前 cookie 通過的是哪一場（未通過回 null）。
 *  刻意只查「還有設碼」的場次：碼一清掉，發出去的 cookie 立刻失效。 */
export async function liveAuthSession(): Promise<{
  sessionId: string;
  expiresAt: Date;
} | null> {
  const jar = await cookies();
  const raw = jar.get(LIVE_COOKIE)?.value;
  if (!raw) return null;

  // 先從 token 取出 sessionId（尚未驗簽，只當查詢用），撈碼後才真正驗簽
  const claimedId = raw.split(".")[1];
  if (!claimedId || !/^[a-z0-9]{1,40}$/.test(claimedId)) return null;
  const row = await prisma.courseSession.findUnique({
    where: { id: claimedId },
    select: { accessCode: true },
  });
  return verifyLiveToken(raw, () => row?.accessCode ?? null);
}

// ─────────────────── 共享限流 ───────────────────
// 沿用 BoardLoginThrottle 表但 key 前綴分開（live-ip:）：
// 學員在 /live 打錯碼被鎖，不該把工作人員鎖在 /board 外面，反之亦然。

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILS = 8; // 學員手打 4 位碼，比 /board 稍寬一點
const IP_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_MAX_FAILS = 200; // 一整班同時進場也不會誤觸；掃碼才會
const GLOBAL_LOCK_MS = 30 * 60 * 1000;

export { getBoardClientIp as getLiveClientIp };

export async function liveLoginBlocked(ip: string): Promise<boolean> {
  const rows = await prisma.boardLoginThrottle.findMany({
    where: { key: { in: [`live-ip:${ip}`, "live-global"] } },
    select: { lockedUntil: true },
  });
  const now = Date.now();
  return rows.some((r) => r.lockedUntil && r.lockedUntil.getTime() > now);
}

async function bumpFail(
  key: string,
  windowMs: number,
  maxFails: number,
  lockMs: number,
): Promise<boolean> {
  const now = new Date();
  const row = await prisma.boardLoginThrottle.findUnique({ where: { key } });
  if (!row || now.getTime() - row.windowStart.getTime() > windowMs) {
    await prisma.boardLoginThrottle.upsert({
      where: { key },
      update: { failCount: 1, windowStart: now, lockedUntil: null },
      create: { key, failCount: 1, windowStart: now },
    });
    return false;
  }
  const failCount = row.failCount + 1;
  const locked = failCount >= maxFails;
  await prisma.boardLoginThrottle.update({
    where: { key },
    data: {
      failCount,
      ...(locked ? { lockedUntil: new Date(now.getTime() + lockMs) } : {}),
    },
  });
  return locked;
}

/** 記一次失敗（IP＋全域雙維度）；不記使用者輸入的碼 */
export async function recordLiveLoginFail(ip: string): Promise<void> {
  await bumpFail(`live-ip:${ip}`, IP_WINDOW_MS, IP_MAX_FAILS, IP_LOCK_MS);
  const globalLocked = await bumpFail(
    "live-global",
    GLOBAL_WINDOW_MS,
    GLOBAL_MAX_FAILS,
    GLOBAL_LOCK_MS,
  );
  if (globalLocked) {
    console.error("[live-auth] 全域上課碼錯誤次數異常，上課連結頁冷卻 30 分鐘");
  }
}

export async function clearLiveLoginFails(ip: string): Promise<void> {
  await prisma.boardLoginThrottle
    .deleteMany({ where: { key: `live-ip:${ip}` } })
    .catch(() => undefined);
}
