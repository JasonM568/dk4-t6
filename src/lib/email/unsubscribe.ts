import "server-only";

import crypto from "node:crypto";

// 退訂連結 token：HMAC-SHA256(UNSUBSCRIBE_SECRET, email 小寫) 的 hex。
// 永久有效（退訂連結不該過期）；驗證用 timingSafeEqual 防時序攻擊。
// 需要環境變數 UNSUBSCRIBE_SECRET（openssl rand -hex 32）。

let warned = false;

function getSecret(): string | null {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) {
    if (!warned) {
      warned = true;
      console.error(
        "[email/unsubscribe] 未設定 UNSUBSCRIBE_SECRET，信件將不含退訂連結",
      );
    }
    return null;
  }
  return secret;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 產生退訂 token（hex 64 字）；無 secret 時回 null（信件就不帶退訂連結，不炸） */
export function unsubscribeToken(email: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(normalizeEmail(email))
    .digest("hex");
}

/** 驗證退訂 token（服務端重算比對；非 hex/長度不符/無 secret 都回 false） */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  if (!expected || !token) return false;
  try {
    const a = Buffer.from(token, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
}

/** 信件 footer 用的退訂「頁面」連結（人點的，進確認畫面） */
export function buildUnsubscribePageUrl(email: string): string | null {
  const token = unsubscribeToken(email);
  if (!token) return null;
  return `${baseUrl()}/unsubscribe?email=${encodeURIComponent(normalizeEmail(email))}&token=${token}`;
}

/** List-Unsubscribe header 用的 one-click 端點（RFC 8058：信箱服務商直接 POST） */
export function buildOneClickUnsubscribeUrl(email: string): string | null {
  const token = unsubscribeToken(email);
  if (!token) return null;
  return `${baseUrl()}/api/unsubscribe?email=${encodeURIComponent(normalizeEmail(email))}&token=${token}`;
}
