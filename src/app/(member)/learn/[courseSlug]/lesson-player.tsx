"use client";

import { useCallback, useEffect, useRef } from "react";

// 每隔幾秒把累積秒數回報一次（同時也是失敗時遺失的上限）
const FLUSH_INTERVAL_SEC = 20;
// 單次回報上限，與 /api/progress 的 deltaSec.max 對齊
const MAX_DELTA = 120;

// YouTube IFrame API 的全域型別（不引第三方型別，宣告用得到的部分即可）
type YTPlayer = {
  getCurrentTime: () => number;
  destroy: () => void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number };
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// 全域只載入一次 IFrame API script，回傳 ready 後的 YT 命名空間
let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT as YTNamespace);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

// 單一章節的播放器：用 key={lessonId} 讓換章節時整個重掛載（卸載前會 flush）。
export function LessonPlayer({
  videoId,
  lessonId,
  title,
}: {
  videoId: string;
  lessonId: string;
  title: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const pendingRef = useRef(0); // 尚未回報的實看秒數
  const playingRef = useRef(false);

  // 把累積秒數送到後端；unload 時用 sendBeacon 確保送得出去
  const flush = useCallback(
    (useBeacon = false) => {
      const delta = Math.min(Math.floor(pendingRef.current), MAX_DELTA);
      if (delta < 1) return;
      pendingRef.current -= delta;
      const positionSec = Math.floor(playerRef.current?.getCurrentTime?.() ?? 0);
      const payload = JSON.stringify({ lessonId, deltaSec: delta, positionSec });

      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/progress",
          new Blob([payload], { type: "application/json" }),
        );
      } else {
        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    },
    [lessonId],
  );

  useEffect(() => {
    let disposed = false;
    let ticker: ReturnType<typeof setInterval> | null = null;

    loadYouTubeApi().then((YT) => {
      if (disposed || !mountRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        videoId,
        playerVars: { rel: 0 },
        events: {
          onStateChange: (e) => {
            const playing = e.data === YT.PlayerState.PLAYING;
            playingRef.current = playing;
            // 暫停/結束時立刻回報目前累積，避免離開頁面前才送
            if (!playing) flush();
          },
        },
      });

      // 每秒計時：只在播放中累計，每滿 FLUSH_INTERVAL_SEC 回報一次
      let elapsed = 0;
      ticker = setInterval(() => {
        if (!playingRef.current) return;
        pendingRef.current += 1;
        elapsed += 1;
        if (elapsed >= FLUSH_INTERVAL_SEC) {
          elapsed = 0;
          flush();
        }
      }, 1000);
    });

    // 切到背景分頁時把累積先送出（行動裝置切走可能不觸發 unmount）
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      if (ticker) clearInterval(ticker);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      flush(true); // 換章節/離開頁面前的最後回報
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, flush]);

  return (
    <div className="aspect-video overflow-hidden rounded-xl bg-black">
      {/* YT.Player 會把這個 div 換成 iframe */}
      <div ref={mountRef} className="h-full w-full" title={title} />
    </div>
  );
}
