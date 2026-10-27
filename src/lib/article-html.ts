import sanitizeHtml from "sanitize-html";

// 文章 HTML 消毒：只用在「舊官網匯入」的 KnowledgeArticle.contentHtml。
// 平台自己寫的內文走 RichText（純文字語法、不碰 innerHTML）；這裡是唯一允許 dangerouslySetInnerHTML 的入口，
// 輸出前一律經過白名單——script／on*／javascript: 全丟、iframe 只放行下列主機、圖片與音訊只收 https。
export const ARTICLE_IFRAME_HOSTS = [
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "embed.podcasts.apple.com",
  "videopress.com",
  "video.wordpress.com",
] as const;

const WP_CLASS = ["wp-*", "has-*", "is-*", "size-*", "aligncenter", "alignleft", "alignright"];

export function sanitizeArticleHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "a",
      "ul", "ol", "li", "blockquote", "pre", "code", "span", "div",
      "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td",
      "iframe", "audio", "source",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading", "class"],
      iframe: ["src", "allow", "allowfullscreen", "width", "height", "title", "loading"],
      audio: ["src", "controls", "preload"],
      source: ["src", "type"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      figure: ["class"],
      figcaption: ["class"],
      div: ["class"],
      p: ["class"],
      ul: ["class"],
      ol: ["class"],
      span: ["class"],
      table: ["class"],
      blockquote: ["class"],
    },
    allowedClasses: {
      figure: WP_CLASS, figcaption: WP_CLASS, div: WP_CLASS, p: WP_CLASS, ul: WP_CLASS, ol: WP_CLASS,
      span: WP_CLASS, table: WP_CLASS, img: WP_CLASS, blockquote: WP_CLASS,
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"], iframe: ["https"], audio: ["https"], source: ["https"] },
    allowedIframeHostnames: [...ARTICLE_IFRAME_HOSTS],
    allowIframeRelativeUrls: false,
    disallowedTagsMode: "discard",
    // src 被（主機／scheme）過濾掉的 iframe／img／audio 整個拿掉，不留空殼
    exclusiveFilter: (frame) => ["iframe", "img", "audio"].includes(frame.tag) && !frame.attribs.src,
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "template"],
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
      iframe: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    },
  });
}

/** HTML → 純文字（摘要用）：去標籤、合併空白 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, nonTextTags: ["style", "script", "iframe", "audio", "figure"] })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
