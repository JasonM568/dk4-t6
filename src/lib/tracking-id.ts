// 追蹤碼 ID 解析（純函式，server action 與離線測試共用）。
// 使用者常直接貼整段安裝碼（gtag / fbq / GTM snippet）或多了空白、小寫——
// 先從貼上內容抽出 ID 再嚴格驗證。ID 會內插進前台 inline script，最終格式一律嚴格白名單。

export type TrackingField = "ga4" | "metaPixel" | "gtm";

const RULES: Record<
  TrackingField,
  { extract: RegExp; valid: RegExp; label: string }
> = {
  // GA4 評估 ID（G-）或 Google 代碼 ID（GT-），gtag.js 兩者皆可 config
  ga4: {
    extract: /\b(GT?-[A-Z0-9]{4,20})\b/i,
    valid: /^GT?-[A-Z0-9]{4,20}$/,
    label: "GA4 ID 格式不正確：應為 G- 開頭（例：G-XXXXXXXXXX），在 GA4「管理 → 資料串流」可找到",
  },
  metaPixel: {
    extract: /(?:fbq\(\s*['"]init['"]\s*,\s*['"]|id=)?\b(\d{5,20})\b/,
    valid: /^\d{5,20}$/,
    label: "Meta Pixel ID 格式不正確：應為純數字（例：1234567890123456）",
  },
  gtm: {
    extract: /\b(GTM-[A-Z0-9]{4,15})\b/i,
    valid: /^GTM-[A-Z0-9]{4,15}$/,
    label: "GTM 容器 ID 格式不正確：應為 GTM- 開頭（例：GTM-XXXXXXX）",
  },
};

/** 空字串 = 停用（ok, value ""）；抽不出合法 ID 回錯誤訊息 */
export function parseTrackingId(
  field: TrackingField,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const input = raw.trim();
  if (!input) return { ok: true, value: "" };
  const rule = RULES[field];
  const m = input.match(rule.extract);
  const value = (m ? m[1] : input).toUpperCase();
  return rule.valid.test(value)
    ? { ok: true, value }
    : { ok: false, error: rule.label };
}
