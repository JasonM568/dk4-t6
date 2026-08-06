import type { ReactNode } from "react";
import { Fragment } from "react";

// 純文字 → 網頁排版：空行分段、段內換行 <br/>、明文網址自動連結、
// **粗體**、## 標題（段落層級）、---（獨立一段）分隔線、
// ![說明](https://圖片網址) 圖片、[按鈕文字](https://網址) 紅色 CTA 按鈕
// （語法與 EDM 內文一致，管理員學一套就好；EDM 端見 lib/email/render-content.ts）。
// 全程組 React 節點不用 dangerouslySetInnerHTML，天然防注入。

// 圖片要先於按鈕比對，否則 ![說明](網址) 的 [說明](網址) 部分會被按鈕規則吃掉
const IMAGE_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
const BUTTON_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
// 網址遇空白/CJK 截斷；結尾半形標點不納入
const URL_RE = /https?:\/\/[^\s　-鿿豈-﫿＀-￯]+/g;

/** 一般文字（無圖片/按鈕語法）→ 節點：**粗體** 與明文網址連結 */
function renderText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  // 先切粗體，再在每個純文字片段裡轉網址連結
  let last = 0;
  const segments: { text: string; bold: boolean }[] = [];
  BOLD_RE.lastIndex = 0;
  for (let m = BOLD_RE.exec(text); m; m = BOLD_RE.exec(text)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });

  for (const seg of segments) {
    const inner: ReactNode[] = [];
    let segLast = 0;
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(seg.text); m; m = URL_RE.exec(seg.text)) {
      const url = m[0].replace(/[).,;:!?]+$/, "");
      if (m.index > segLast) inner.push(seg.text.slice(segLast, m.index));
      inner.push(
        <a
          key={`${keyPrefix}-u${i++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-red-800 underline"
        >
          {url}
        </a>,
      );
      segLast = m.index + url.length;
    }
    if (segLast < seg.text.length) inner.push(seg.text.slice(segLast));
    nodes.push(
      seg.bold ? (
        <strong key={`${keyPrefix}-b${i++}`}>{inner}</strong>
      ) : (
        <Fragment key={`${keyPrefix}-t${i++}`}>{inner}</Fragment>
      ),
    );
  }
  return nodes;
}

function renderLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = line;
  let i = 0;
  while (rest.length > 0) {
    // 找最早出現的圖片或按鈕語法；圖片優先（按鈕規則會誤吃圖片語法的後半）
    IMAGE_RE.lastIndex = 0;
    BUTTON_RE.lastIndex = 0;
    const img = IMAGE_RE.exec(rest);
    const btnRaw = BUTTON_RE.exec(rest);
    // 按鈕比對若落在圖片語法範圍內（[…](…) 是 ![…](…) 的尾巴）則不算
    const btn =
      btnRaw && (!img || btnRaw.index < img.index || btnRaw.index >= img.index + img[0].length)
        ? btnRaw
        : null;
    const hit =
      img && (!btn || img.index <= btn.index) ? { kind: "img" as const, m: img } :
      btn ? { kind: "btn" as const, m: btn } : null;

    const head = hit ? rest.slice(0, hit.m.index) : rest;
    nodes.push(...renderText(head, `${keyPrefix}-h${i}`));

    if (!hit) break;
    if (hit.kind === "img") {
      nodes.push(
        // eslint-disable-next-line @next/next/no-img-element -- 內容圖片網址由管理員自由貼入，非固定尺寸
        <img
          key={`${keyPrefix}-i${i++}`}
          src={hit.m[2]}
          alt={hit.m[1].trim()}
          className="my-2 block w-full rounded-lg"
        />,
      );
    } else {
      nodes.push(
        <a
          key={`${keyPrefix}-c${i++}`}
          href={hit.m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="my-1 inline-block rounded-lg bg-gradient-to-br from-red-800 to-red-600 px-9 py-3 font-bold text-white no-underline transition hover:opacity-90"
        >
          {hit.m[1].trim()}
        </a>,
      );
    }
    rest = rest.slice(hit.m.index + hit.m[0].length);
    i++;
  }
  return nodes;
}

export function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((raw, pi) => {
        const p = raw.trim();
        if (/^-{3,}$/.test(p)) {
          return <hr key={pi} className="my-6 border-t border-gray-200" />;
        }
        if (p.startsWith("## ")) {
          return (
            <p key={pi} className="mb-3 mt-6 text-xl font-bold leading-snug text-gray-900">
              {p
                .slice(3)
                .trim()
                .split("\n")
                .map((line, li, arr) => (
                  <Fragment key={li}>
                    {renderLine(line, `${pi}-${li}`)}
                    {li < arr.length - 1 && <br />}
                  </Fragment>
                ))}
            </p>
          );
        }
        return (
          <p key={pi} className="mb-4 leading-relaxed text-gray-700">
            {p.split("\n").map((line, li, arr) => (
              <Fragment key={li}>
                {renderLine(line, `${pi}-${li}`)}
                {li < arr.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
