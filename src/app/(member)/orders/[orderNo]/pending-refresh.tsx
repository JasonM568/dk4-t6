"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** 付款確認中的自動刷新：PAYUNi 前景導回與背景通知是兩條路賽跑，
 *  使用者回到這頁時訂單可能還是待付款（通知晚幾秒）。每 3 秒刷新一次、
 *  最多 10 次——狀態一變成已付款，server component 重渲染就會顯示感謝區塊。 */
export function PendingRefresh() {
  const router = useRouter();
  const count = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      count.current += 1;
      if (count.current > 10) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);

  return null;
}
