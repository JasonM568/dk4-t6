// 院長乾貨區的分類（對應舊官網 academy4hope.com 的文章子分類）。
// 文章用 KnowledgeArticle.tags 存分類名稱（一篇一個主分類），前台用 ?cat=<slug> 篩選。
export const KNOWLEDGE_CATEGORIES = [
  { slug: "news", name: "新聞速報", blurb: "每日重點新聞圖卡" },
  { slug: "finance", name: "財經快報", blurb: "每日市場與財經速覽" },
  { slug: "global", name: "全球財經", blurb: "國際財經深度整理" },
  { slug: "dean", name: "顧名思易", blurb: "院長專欄" },
  { slug: "morning", name: "晨間小語", blurb: "院長 Podcast 晨間小語" },
  { slug: "free", name: "搶先試看", blurb: "免費公開試讀" },
] as const;

export type KnowledgeCategorySlug = (typeof KNOWLEDGE_CATEGORIES)[number]["slug"];

export function knowledgeCategoryBySlug(slug: string | undefined | null) {
  return KNOWLEDGE_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/** 舊站文章標題一律以【分類】開頭，例如「【晨間小語】直面人生」；拿來當分類的備援判斷 */
export function categoryNameFromTitle(title: string): string | null {
  const m = /^【([^】]+)】/.exec(title.trim());
  if (!m) return null;
  return KNOWLEDGE_CATEGORIES.find((c) => c.name === m[1])?.name ?? null;
}
