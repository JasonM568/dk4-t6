"use client";

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** 全站追蹤碼（GA4 / Meta Pixel / GTM）；後台 /admin 一律不載入。
 *  page_view 統一由 PageViewTracker 在路由切換時發送（GA4 config 關閉自動 page_view，
 *  Pixel init 後不自動 PageView），避免首次載入重複計數 */
export function TrackingScripts({
  ga4,
  metaPixel,
  gtm,
}: {
  ga4: string;
  metaPixel: string;
  gtm: string;
}) {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <>
      {gtm && (
        <>
          <Script id="gtm-init" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtm}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        </>
      )}

      {ga4 && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${ga4}',{send_page_view:false});`}
          </Script>
        </>
      )}

      {metaPixel && (
        <>
          <Script id="meta-pixel-init" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixel}');`}
          </Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${metaPixel}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      <Suspense>
        <PageViewTracker hasGa4={!!ga4} hasPixel={!!metaPixel} />
      </Suspense>
    </>
  );
}

/** 路由切換（含首次載入）統一發送 page_view；useSearchParams 需 Suspense 邊界 */
function PageViewTracker({
  hasGa4,
  hasPixel,
}: {
  hasGa4: boolean;
  hasPixel: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrl = useRef<string>("");

  useEffect(() => {
    const qs = searchParams.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (url === lastUrl.current) return;
    lastUrl.current = url;
    if (hasGa4) window.gtag?.("event", "page_view", { page_path: url });
    if (hasPixel) window.fbq?.("track", "PageView");
  }, [pathname, searchParams, hasGa4, hasPixel]);

  return null;
}
