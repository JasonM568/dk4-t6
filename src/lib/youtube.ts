// 從各種使用者可能貼上的格式抽出 YouTube 影片 ID（11 碼）。
// 支援：純 ID、watch?v=、youtu.be/、/embed/、/shorts/、/live/、整段 iframe 嵌入碼。
// 抽不出來回傳 null。
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYoutubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 純 ID
  if (ID_RE.test(raw)) return raw;

  // iframe 嵌入碼：先抽 src 再走網址解析
  const srcMatch = raw.match(/src=["']([^"']+)["']/i);
  const candidate = srcMatch ? srcMatch[1] : raw;

  const urlMatch = candidate.match(
    /(?:youtube\.com\/(?:watch\?(?:[^"'\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  );
  return urlMatch ? urlMatch[1] : null;
}
