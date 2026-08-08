import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

// 看板 4 位碼閘門（合作方免帳號查看，看板只露姓名不露聯絡資料）。
// cookie 值 = `v1.${exp}.${nonce}.${hmac}`：
//   hmac = HMAC-SHA256(BOARD_SESSION_SECRET, version:code:exp:nonce)
// 改碼、換 secret、bump TOKEN_VERSION 或逾時皆立即失效；驗證走 timingSafeEqual。
// 暴力防護：DB 共享限流（跨 instance 有效），同 IP 連錯 5 次鎖 15 分鐘。

export const BOARD_COOKIE = "board_auth";
const TOKEN_VERSION = "v1"; // 換 secret 或 token 格式時 bump，讓所有舊 cookie 失效

/** 看板 session 專用 secret：獨立必填、不沿用其他 secret、無固定 fallback。
 *  缺漏或過短時安全失敗——記設定錯誤、不發新 session、既有 cookie 全數驗不過。 */
function boardSecret(): string | null {
  const s = process.env.BOARD_SESSION_SECRET;
  if (!s || s.trim().length < 32) {
    console.error(
      "[board-auth] BOARD_SESSION_SECRET 未設定或長度不足 32 字元，看板登入停用",
    );
    return null;
  }
  return s;
}

function sign(secret: string, code: string, expMs: number, nonce: string): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}:${code}:${expMs}:${nonce}`)
    .digest("hex");
}

/** 簽發看板 token；secret 缺漏回 null（呼叫端要擋下並回報設定錯誤） */
export function signBoardToken(code: string, expMs: number): string | null {
  const secret = boardSecret();
  if (!secret) return null;
  const nonce = randomBytes(8).toString("hex");
  return `${TOKEN_VERSION}.${expMs}.${nonce}.${sign(secret, code, expMs, nonce)}`;
}

/** 驗看板 token：版本/格式/到期/簽章全過才回到期時間，否則 null */
export function verifyBoardToken(raw: string, code: string): Date | null {
  const secret = boardSecret();
  if (!secret) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [ver, expStr, nonce, mac] = parts;
  if (ver !== TOKEN_VERSION) return null;
  if (!/^\d{1,15}$/.test(expStr)) return null;
  const expMs = Number(expStr);
  if (expMs <= Date.now()) return null;
  if (!/^[0-9a-f]{16}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return null;
  const expect = Buffer.from(sign(secret, code, expMs, nonce), "hex");
  const given = Buffer.from(mac, "hex");
  if (given.length !== expect.length) return null;
  return timingSafeEqual(given, expect) ? new Date(expMs) : null;
}

/** 恆定時間比對登入碼（先雜湊拉平長度差，時序不洩漏正確位數） */
export function boardCodeEquals(input: string, code: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(code).digest();
  return timingSafeEqual(a, b);
}

export async function getBoardCode(): Promise<string | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: "boardCode" } });
  const code = row?.value ?? null;
  // 設定值也守 4 位數字（歷史資料或繞過 UI 寫入的異常值一律視為未設定）
  return code && /^\d{4}$/.test(code) ? code : null;
}

/** 看板登入時效（小時），後台設定；預設 8，上限 24（原 720 過長已收斂） */
export async function getBoardSessionHours(): Promise<number> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: "boardSessionHours" },
  });
  const n = Number(row?.value);
  if (!Number.isFinite(n)) return 8;
  return Math.min(24, Math.max(1, Math.round(n)));
}

/** 看板驗證狀態：expiresAt 有值 = 已通過且未逾時 */
export async function boardAuthStatus(): Promise<{ expiresAt: Date | null }> {
  const code = await getBoardCode();
  if (!code) return { expiresAt: null }; // 未設定登入碼 = 看板關閉
  const jar = await cookies();
  const raw = jar.get(BOARD_COOKIE)?.value;
  if (!raw) return { expiresAt: null };
  return { expiresAt: verifyBoardToken(raw, code) };
}

// ─────────────────── 共享限流（DB 表，跨 serverless instance）───────────────────

const IP_WINDOW_MS = 15 * 60 * 1000; // 失敗計數視窗
const IP_MAX_FAILS = 5; // 第 5 次失敗即鎖 → 第 6 次嘗試被擋
const IP_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 10 * 60 * 1000; // 全域異常門檻（分散來源掃碼）
const GLOBAL_MAX_FAILS = 100;
const GLOBAL_LOCK_MS = 60 * 60 * 1000;

/** 取用戶端 IP：只信 Vercel/可信代理設定的標頭，不信任意 X-Forwarded-For 全串 */
export async function getBoardClientIp(): Promise<string> {
  const h = await headers();
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const vercel = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  // 本機 dev：無代理時取第一段（dev 環境才會走到這）
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "unknown";
}

/** 是否在鎖定中（IP 或全域） */
export async function boardLoginBlocked(ip: string): Promise<boolean> {
  const rows = await prisma.boardLoginThrottle.findMany({
    where: { key: { in: [`ip:${ip}`, "global"] } },
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

/** 記一次登入失敗（IP＋全域雙維度）；不記使用者輸入的碼 */
export async function recordBoardLoginFail(ip: string): Promise<void> {
  await bumpFail(`ip:${ip}`, IP_WINDOW_MS, IP_MAX_FAILS, IP_LOCK_MS);
  const globalLocked = await bumpFail(
    "global",
    GLOBAL_WINDOW_MS,
    GLOBAL_MAX_FAILS,
    GLOBAL_LOCK_MS,
  );
  if (globalLocked) {
    // 告警：分散式掃碼跡象，全域冷卻 60 分鐘（Vercel logs 可設告警）
    console.error("[board-auth] 全域登入失敗次數異常，看板登入冷卻 60 分鐘");
  }
}

/** 登入成功：重置該 IP 的失敗計數 */
export async function clearBoardLoginFails(ip: string): Promise<void> {
  await prisma.boardLoginThrottle
    .deleteMany({ where: { key: `ip:${ip}` } })
    .catch(() => undefined);
}
