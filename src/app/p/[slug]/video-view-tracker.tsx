"use client";

import { useEffect } from "react";

/** 有影片的自訂頁發 Pixel ViewContent（＋GA 事件）——FB 廣告後台即可用
 *  「ViewContent 且 content_type=video_page」圈出看過影片的人做再行銷受眾。
 *  追蹤碼未設定時 window.fbq/gtag 不存在，安靜略過。 */
export function VideoViewTracker({ slug, title }: { slug: string; title: string }) {
  useEffect(() => {
    window.fbq?.("track", "ViewContent", {
      content_name: title,
      content_ids: [slug],
      content_type: "video_page",
    });
    window.gtag?.("event", "view_video_page", { page_slug: slug });
  }, [slug, title]);
  return null;
}
