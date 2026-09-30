// 追蹤碼 ID 解析＋表單契約（離線）：npx tsx scripts/test-tracking-id.ts
// 2026-09-30：GA4 欄位貼代碼按儲存就消失——格式被退回時未受控欄位被 React 19 重置
import { readFileSync } from "node:fs";
import { parseTrackingId, type TrackingField } from "../src/lib/tracking-id";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
}
function expectId(field: TrackingField, raw: string, want: string) {
  const r = parseTrackingId(field, raw);
  check(`${field} ← ${JSON.stringify(raw.slice(0, 50))}`, r.ok && r.value === want, JSON.stringify(r));
}
function expectError(field: TrackingField, raw: string) {
  const r = parseTrackingId(field, raw);
  check(`${field} 拒收 ${JSON.stringify(raw.slice(0, 50))}`, !r.ok, JSON.stringify(r));
}

const gtag = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>
<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());gtag('config', 'G-AB12CD34EF');</script>`;
const fbq = `<script>!function(f,b,e,v,n,t,s){...}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '186659658334947');fbq('track', 'PageView');</script>
<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=186659658334947&ev=PageView&noscript=1"/></noscript>`;
const gtm = `<script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-ABC1234');</script>`;

// GA4
expectId("ga4", "G-CC3K4JNH4H", "G-CC3K4JNH4H");
expectId("ga4", "  g-cc3k4jnh4h \n", "G-CC3K4JNH4H");
expectId("ga4", gtag, "G-AB12CD34EF");
expectId("ga4", "GT-ABCD1234", "GT-ABCD1234");
expectId("ga4", "", "");
expectError("ga4", "123456789"); // 資料串流 ID／資源 ID 不是評估 ID
expectError("ga4", "UA-12345-1"); // 舊版 UA
expectError("ga4", "G-AB'); alert(1);//");
// Pixel
expectId("metaPixel", "186659658334947", "186659658334947");
expectId("metaPixel", fbq, "186659658334947");
expectError("metaPixel", "abc");
// GTM
expectId("gtm", "gtm-abc1234", "GTM-ABC1234");
expectId("gtm", gtm, "GTM-ABC1234");
expectError("gtm", "G-AB12CD34EF");

// 表單契約：欄位必須受控，錯誤要顯示在該欄
const form = readFileSync("src/app/(admin)/admin/settings/tracking-form.tsx", "utf8");
check("追蹤碼表單不用 defaultValue（受控欄位）", !/defaultValue=/.test(form));
check("追蹤碼表單 input 綁 value", /value=\{values\[f\.key\]\}/.test(form));
check("錯誤訊息顯示在出錯的那一格", /state\?\.field === f\.key/.test(form));

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
