import { sanitizeArticleHtml } from "@/lib/article-html";

// 舊官網匯入文章的內文渲染。整個專案只有這裡用 dangerouslySetInnerHTML：
// 輸入一律先過 sanitizeArticleHtml（白名單標籤／屬性、iframe 限定主機、只收 https 圖片與音訊），
// 樣式在 globals.css 的 .article-html。平台自己寫的文章請用 RichText，不要走這裡。
export function ArticleHtml({ html }: { html: string }) {
  const safe = sanitizeArticleHtml(html);
  return <div className="article-html" dangerouslySetInnerHTML={{ __html: safe }} />;
}
