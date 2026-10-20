import "server-only";

import { prisma } from "@/lib/db";
import { WEALTH5_DEFAULT_LINKS, type Wealth5Links } from "@/lib/wealth5-check";

// 檢測頁 CTA 連結：存 SiteSetting（key = wealth5:link:<name>），沒有資料列就用程式預設。
// 10/31 講座等外部報名頁網址常臨時才拿到，用設定列可以不經部署直接換。
const KEYS: Record<keyof Wealth5Links, string> = {
  course: "wealth5:link:course",
  talk1031: "wealth5:link:talk1031",
  reading1118: "wealth5:link:reading1118",
  self: "wealth5:link:self",
};

/** 只接受 http(s) 或站內相對路徑；其他內容（javascript: 等）一律丟掉回預設 */
function safeLink(v: string | undefined, fallback: string): string {
  const s = (v ?? "").trim();
  if (!s) return fallback;
  if (/^https?:\/\//i.test(s) || /^\/[^/\\]/.test(s)) return s.slice(0, 500);
  return fallback;
}

export async function getWealth5Links(): Promise<Wealth5Links> {
  // 非關鍵資料：DB 瞬斷時用預設值，不讓引流頁整頁失敗
  const rows = await prisma.siteSetting
    .findMany({ where: { key: { in: Object.values(KEYS) } } })
    .catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    course: safeLink(map.get(KEYS.course), WEALTH5_DEFAULT_LINKS.course),
    talk1031: safeLink(map.get(KEYS.talk1031), WEALTH5_DEFAULT_LINKS.talk1031),
    reading1118: safeLink(map.get(KEYS.reading1118), WEALTH5_DEFAULT_LINKS.reading1118),
    self: safeLink(map.get(KEYS.self), WEALTH5_DEFAULT_LINKS.self),
  };
}
