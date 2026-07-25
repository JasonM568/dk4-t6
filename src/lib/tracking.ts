import "server-only";

import { prisma } from "@/lib/db";

// 全站追蹤碼設定：存 SiteSetting key-value（後台 /admin/settings 維護）。
// 空字串/無資料列 = 未啟用該追蹤碼。

const KEYS = {
  ga4: "tracking:ga4",
  metaPixel: "tracking:metaPixel",
  gtm: "tracking:gtm",
} as const;

export type TrackingSettings = { ga4: string; metaPixel: string; gtm: string };

export async function getTrackingSettings(): Promise<TrackingSettings> {
  // 追蹤碼是非關鍵功能：root layout 每頁都會呼叫，DB 瞬斷時降級為「全部未啟用」，
  // 不讓建置預渲染或線上頁面因此整個失敗（曾因 pooler 抖動連炸三次 Vercel build）
  const rows = await prisma.siteSetting
    .findMany({ where: { key: { in: Object.values(KEYS) } } })
    .catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value.trim()]));
  return {
    ga4: map.get(KEYS.ga4) ?? "",
    metaPixel: map.get(KEYS.metaPixel) ?? "",
    gtm: map.get(KEYS.gtm) ?? "",
  };
}

export const TRACKING_KEYS = KEYS;
