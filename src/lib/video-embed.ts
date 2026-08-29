// 影片網址 → 嵌入資訊（純函式，前後台共用）。
// YouTube（含 shorts/youtu.be/live）轉 youtube-nocookie 嵌入網址（CSP frame-src 已放行）；
// 其他 https 網址視為影片檔直連（mp4/webm），前台用 <video> 播。

const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,20})/;

/** 從各種 YouTube 網址格式取出影片 ID；不是 YouTube 回 null。 */
export function youTubeVideoId(url: string): string | null {
  return url.match(YOUTUBE_ID_RE)?.[1] ?? null;
}

export function youTubeEmbedUrl(url: string): string | null {
  const id = youTubeVideoId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/** YouTube 影片縮圖（後台排序清單顯示用）；CSP img-src 已放行 i.ytimg.com。
 *  非 YouTube（影片檔直連）沒有現成縮圖，回 null 讓 UI 顯示替代圖示。 */
export function youTubeThumbnailUrl(url: string): string | null {
  const id = youTubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}
