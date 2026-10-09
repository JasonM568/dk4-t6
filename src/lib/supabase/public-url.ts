/** 剪報只能引用本站 course-assets 公開 bucket 的上傳圖片。 */
export const MAX_BRIEF_IMAGES = 30;

export function isOurStorageUrl(url: string): boolean {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!origin || url !== url.trim()) return false;
  try {
    const site = new URL(origin);
    const image = new URL(url);
    if (site.protocol !== "https:" &&
        !(site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname))) return false;
    if (image.protocol !== site.protocol || image.host !== site.host ||
        image.username || image.password) return false;
    const authority = `${site.protocol}//${site.host}`;
    if (!url.startsWith(`${authority}/`)) return false;
    // URL() 會先消去 ../；以原始 path 檢查，避免穿越在解析前被隱藏。
    const rawPath = url.slice(authority.length).split(/[?#]/, 1)[0];
    if (/%2e|%2f/i.test(rawPath) || /(^|\/)\.\.(\/|$)/.test(rawPath)) return false;
    const prefix = "/storage/v1/object/public/course-assets/";
    return image.pathname.startsWith(prefix) && !!image.pathname.slice(prefix.length).split("/").at(-1);
  } catch {
    return false;
  }
}
