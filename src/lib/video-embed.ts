// 影片網址 → 嵌入資訊（純函式，前後台共用）。
// YouTube（含 shorts/youtu.be/live）轉 youtube-nocookie 嵌入網址（CSP frame-src 已放行）；
// 其他 https 網址視為影片檔直連（mp4/webm），前台用 <video> 播。

export function youTubeEmbedUrl(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,20})/,
  );
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}
