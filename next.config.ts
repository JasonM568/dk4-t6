import type { NextConfig } from "next";

// ─────────────────── 全站安全標頭 ───────────────────
// CSP 分兩層：
//   1. 正式 CSP 只鎖 frame-ancestors/base-uri/object-src（clickjacking 防護立即生效，
//      不會誤殺既有功能）
//   2. 完整白名單 CSP 先掛 Report-Only 蒐集違規——在 preview/正式站觀察一段時間、
//      確認無誤殺後，把 REPORT_ONLY_CSP 內容搬進正式 CSP 即可切換為阻擋
//      （違規進 /api/csp-report → course."CspReport"，依 count 排序即可判斷會不會誤殺）
// 白名單依實際使用來源：Supabase Storage/Auth、YouTube 影片、Google Slides/Canva
// 簡報嵌入、ECPay 跳轉、GA4/Meta Pixel/GTM 追蹤碼（後台僅 admin 可設、ID 格式嚴格驗證）

const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "*.supabase.co";
  }
})();

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  // Next.js inline bootstrap 與 GA/Pixel 起始碼需要 'unsafe-inline'（未採 nonce 架構的取捨）；
  // 外部 script 來源仍鎖白名單，未列入的網域一律擋
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${SUPABASE_HOST} https://www.googletagmanager.com https://*.google-analytics.com https://www.facebook.com https://i.ytimg.com`,
  "font-src 'self' data:",
  // 自訂頁短影片：YouTube 走 frame-src；影片檔直連（Supabase）走 media-src
  `media-src 'self' https://${SUPABASE_HOST}`,
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://docs.google.com https://www.canva.com https://www.googletagmanager.com",
  `connect-src 'self' https://${SUPABASE_HOST} https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://connect.facebook.net https://www.facebook.com`,
  // 結帳表單 POST 到 ECPay（正式/沙箱）
  "form-action 'self' https://payment.ecpay.com.tw https://payment-stage.ecpay.com.tw",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  // 違規回報收集端點：沒有這行的話 Report-Only 只會印在使用者的 console，沒人看得到
  "report-uri /api/csp-report",
].join("; ");

const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // 舊瀏覽器的 clickjacking 防線（新瀏覽器走 CSP frame-ancestors）
  { key: "X-Frame-Options", value: "DENY" },
  // 全站 HTTPS（Vercel）；不設 includeSubDomains——huangxi.info 其他子網域非本專案管
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "Content-Security-Policy", value: ENFORCED_CSP },
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 後台課程圖片走 server action 上傳，放寬 body 上限（預設 1MB）
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
