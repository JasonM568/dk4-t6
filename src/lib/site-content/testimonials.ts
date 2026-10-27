// 學員見證：舊官網 academy4hope.com/student 是 22 支 Instagram Reel 嵌入（@ceohope_tw）。
// 這裡只存 reel 代碼；前台用 instagram.com/reel/<code>/embed/ 的 iframe 版嵌入（不載 instagram 的 embed.js）。
export const TESTIMONIAL_REELS = [
  "DRyrEZIklxJ", "DRytASVkjvz", "DRyucMlEm2g",
  "DSHQUxxEl_a", "DSHSDQ9EgX3", "DSHSTigkqRm", "DSHSpkqEtZr", "DSHTWzpEg3D",
  "DSHjqKSEua9", "DSHk9vhkmZ0", "DSHkUF-kojG", "DSHkg-Wkic2", "DSHlitDEtPW", "DSHm3QSkugl",
  "DSUJjA5kvJX", "DSUL58tkvHX", "DSULPtykuHY", "DSUM6LPkoKt", "DSUMYjPkjjq", "DSUNZL2EvUe", "DSUNuxwktdv", "DSUONYEkvxF",
];

export const TESTIMONIAL_IG_PROFILE = "https://www.instagram.com/ceohope_tw/";

export function reelEmbedUrl(code: string): string {
  return `https://www.instagram.com/reel/${code}/embed/`;
}
