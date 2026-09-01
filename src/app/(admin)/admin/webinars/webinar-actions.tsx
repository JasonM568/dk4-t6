"use client";

import { useState } from "react";
import { normalizeMobile } from "@/lib/sms/phone";

// 講座索取名單的兩顆共用按鈕：後台講座頁與場次看板的講座區塊都用這一份。
//
// 「複製手機名單」存在的理由：簡訊模組已經能直接吃講座名單（audienceType=WEBINAR），
// 但名單有時要餵給站外的東西（LINE 群、電訪清單、另一套工具），
// 那時只想要一份乾淨的號碼，不想繞一圈。

export function CopyPhonesButton({
  requests,
  label = "複製手機名單",
}: {
  requests: { name: string | null; phone: string | null }[];
  label?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  // normalizeMobile（而非 normalizeContactPhone）：這份名單的用途是發簡訊，
  // 海外門號本來就發不出去，複製出去只會讓人以為發得到。
  const rows = requests
    .map((r) => ({ mobile: normalizeMobile(r.phone), name: r.name?.trim() ?? "" }))
    .filter((r): r is { mobile: string; name: string } => !!r.mobile);
  // 同一支號碼只留一筆（家人共用信箱各自登記時會撞號）
  const seen = new Set<string>();
  const unique = rows.filter((r) => !seen.has(r.mobile) && seen.add(r.mobile));
  const text = unique.map((r) => (r.name ? `${r.mobile},${r.name}` : r.mobile)).join("\n");

  const copy = async () => {
    if (unique.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`已複製 ${unique.length} 筆`);
    } catch {
      // 非 https 或瀏覽器擋剪貼簿時的退路：至少讓人看得到內容可以手動選取
      setCopied("複製失敗，請手動選取");
      console.error("[webinar] clipboard 不可用，名單內容：\n" + text);
    }
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={unique.length === 0}
      title={
        unique.length === 0
          ? "這場沒有可發簡訊的手機號碼"
          : "一行一筆「手機,姓名」，可直接貼進簡訊的「手動貼入名單」"
      }
      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ?? `📋 ${label}（${unique.length}）`}
    </button>
  );
}
