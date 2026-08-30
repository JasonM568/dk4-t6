"use client";

import { useEffect } from "react";

/** 導去外部報名頁（1shop）的 CTA。
 *
 *  為什麼要自己發事件：成交發生在 1shop，我們追不到 Purchase。
 *  但「看了這一頁」與「點了報名」這兩層還在自家網域，發成 Pixel 事件後
 *  FB 後台就能圈出「看過課程頁但沒點報名」「點了報名但沒成交」做再行銷。
 *  追蹤碼未設定時 window.fbq/gtag 不存在，安靜略過（同 VideoViewTracker）。 */
export function ExternalSignupCta({
  slug,
  title,
  url,
  label,
}: {
  slug: string;
  title: string;
  url: string;
  /** 按鈕文字；後台可自訂（例：前往查看課程介紹），空值用預設 */
  label?: string | null;
}) {
  useEffect(() => {
    window.fbq?.("track", "ViewContent", {
      content_name: title,
      content_ids: [slug],
      content_type: "course_signup_page",
    });
    window.gtag?.("event", "view_signup_page", { page_slug: slug });
  }, [slug, title]);

  const onClick = () => {
    window.fbq?.("track", "InitiateCheckout", {
      content_name: title,
      content_ids: [slug],
      content_type: "course_signup_page",
    });
    window.gtag?.("event", "click_signup", { page_slug: slug });
  };

  return (
    <div className="rounded-2xl border border-gray-200 p-5 text-center">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="block w-full rounded-xl bg-gradient-to-br from-red-800 to-red-600 px-5 py-4 text-lg font-bold text-white transition hover:opacity-90"
      >
        {label || "立即報名"}
      </a>
      <p className="mt-3 text-xs text-gray-500">
        點擊後前往報名系統完成填表與付款
      </p>
    </div>
  );
}
