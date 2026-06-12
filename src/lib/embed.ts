// 把常見的線上簡報「分享網址」轉成可嵌入 iframe 的網址。
// 支援 Google Slides 與 Canva；其他網址原樣回傳（多數服務的嵌入網址可直接用）。
export function toSlideEmbedUrl(input: string): string {
  const url = input.trim();
  if (!url) return url;

  // Google Slides：.../presentation/d/<id>/edit... 或 /pub... → /embed
  const gs = url.match(
    /docs\.google\.com\/presentation\/d\/(e\/)?([A-Za-z0-9_-]+)/,
  );
  if (gs) {
    return `https://docs.google.com/presentation/d/${gs[1] ?? ""}${gs[2]}/embed?start=false&loop=false`;
  }

  // Canva：.../design/<id>/.../view... → 加上 ?embed
  const canva = url.match(/canva\.com\/design\/([^/]+)\/([^/?]+)\/(view|watch)/);
  if (canva) {
    return `https://www.canva.com/design/${canva[1]}/${canva[2]}/${canva[3]}?embed`;
  }

  return url;
}
