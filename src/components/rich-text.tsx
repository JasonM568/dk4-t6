import type { ReactNode } from "react";
import { Fragment } from "react";

// 純文字 → 網頁排版：空行分段、段內換行 <br/>、明文網址自動連結、
// [按鈕文字](https://網址) 轉紅色 CTA 按鈕（語法與 EDM 內文一致，管理員學一套就好）。
// 全程組 React 節點不用 dangerouslySetInnerHTML，天然防注入。

const BUTTON_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
// 網址遇空白/CJK 截斷；結尾半形標點不納入
const URL_RE = /https?:\/\/[^\s　-鿿豈-﫿＀-￯]+/g;

function renderLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = line;
  let i = 0;
  while (rest.length > 0) {
    BUTTON_RE.lastIndex = 0;
    const btn = BUTTON_RE.exec(rest);
    const head = btn ? rest.slice(0, btn.index) : rest;

    // 按鈕前的一般文字：明文網址轉連結
    let last = 0;
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(head); m; m = URL_RE.exec(head)) {
      const url = m[0].replace(/[).,;:!?]+$/, "");
      if (m.index > last) nodes.push(head.slice(last, m.index));
      nodes.push(
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
      last = m.index + url.length;
    }
    if (last < head.length) nodes.push(head.slice(last));

    if (!btn) break;
    nodes.push(
      <a
        key={`${keyPrefix}-b${i++}`}
        href={btn[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="my-1 inline-block rounded-lg bg-gradient-to-br from-red-800 to-red-600 px-9 py-3 font-bold text-white no-underline transition hover:opacity-90"
      >
        {btn[1].trim()}
      </a>,
    );
    rest = rest.slice(btn.index + btn[0].length);
  }
  return nodes;
}

export function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((p, pi) => (
        <p key={pi} className="mb-4 leading-relaxed text-gray-700">
          {p
            .trim()
            .split("\n")
            .map((line, li, arr) => (
              <Fragment key={li}>
                {renderLine(line, `${pi}-${li}`)}
                {li < arr.length - 1 && <br />}
              </Fragment>
            ))}
        </p>
      ))}
    </>
  );
}
