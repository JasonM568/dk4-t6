import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isPageEnabled } from "@/lib/site-pages";
import { getTrackingSettings } from "@/lib/tracking";
import { getWealth5Links } from "@/lib/wealth5-links";
import { WEALTH5_CONTENT } from "@/lib/wealth5-content";

// 五種財富自我檢測頁：Codex 產出的單檔 HTML（src/content/wealth5-check.html）原樣回傳，
// 只在 <head> 的 <!--W5C_INJECT--> 注入兩樣東西：
//   1. window.__W5C_CONTENT__：題庫／文案／矩陣／計分參數＋ CTA 連結（唯一真相在 src/lib）
//   2. 平台的 GA4／Meta Pixel 起始碼（後台分頁管理設定；沒設就不注入）
// 不走 root layout：這頁是獨立深色單頁，沒有導覽列與頁尾。
// 分頁管理把「五力檢測」關掉時回 404。
export const dynamic = "force-dynamic";

const HTML_PATH = join(process.cwd(), "src/content/wealth5-check.html");

/** JSON 進 <script> 要防 </script> 與行分隔字元：把 < 與 U+2028/2029 轉成 \u 逸出 */
function jsonForScript(value: unknown): string {
  // 行分隔字元用 charCode 組 RegExp：原始碼裡寫 \u2028 字面值會被當成換行、截斷 regex
  const lineSeps = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(lineSeps, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
}

/** 只放行追蹤碼該有的字元，避免設定列被塞進 script 內容 */
function safeId(v: string): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "";
}

function trackingSnippet(t: { ga4: string; metaPixel: string }): string {
  const ga4 = safeId(t.ga4);
  const pixel = safeId(t.metaPixel);
  const parts: string[] = [];
  if (ga4) {
    parts.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga4}');</script>`,
    );
  }
  if (pixel) {
    parts.push(
      `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');</script>`,
    );
  }
  return parts.join("\n");
}

export async function GET() {
  if (!(await isPageEnabled("wealth5"))) return new NextResponse("Not Found", { status: 404 });

  const [tracking, links] = await Promise.all([getTrackingSettings(), getWealth5Links()]);
  const html = readFileSync(HTML_PATH, "utf8");
  const inject = [
    `<script>window.__W5C_CONTENT__=${jsonForScript({ ...WEALTH5_CONTENT, links })};</script>`,
    trackingSnippet(tracking),
  ].join("\n");

  return new NextResponse(html.replace("<!--W5C_INJECT-->", inject), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // CDN 快取 60 秒：連結或追蹤碼改了最多一分鐘生效；瀏覽器不留快取
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
    },
  });
}
