"use client";

import { useState, useTransition } from "react";
import { normalizeMobile, formatMobile } from "@/lib/sms/phone";
import {
  backfillWebinarPhonesAction,
  dismissBlockedWebinarAttemptAction,
  resendBlockedWebinarAttemptAction,
} from "@/actions/webinar";
import type { BackfillReport } from "@/lib/webinar-phone-backfill";

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

/** 從會員資料補手機：姓名吻合的直接寫入，其餘列出來讓管理員自己判斷。
 *
 *  刻意把「不敢補的那幾筆」攤開顯示——只回報「已補 N 筆」會讓人以為補完了，
 *  實際上最需要人處理的正是沒補的那些。 */
export function BackfillPhonesButton({ webinarId }: { webinarId: string }) {
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => setReport(await backfillWebinarPhonesAction(webinarId)))
        }
        title="用 email 比對會員補填／上課記錄卡／訂單名單，姓名對得起來才寫入"
        className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "比對中…" : "🔎 從會員資料補手機"}
      </button>

      {report && (
        <div className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
          {report.rows.length === 0 ? (
            <p className="text-gray-500">這場沒有缺手機的索取紀錄。</p>
          ) : (
            <>
              <p className="mb-2 font-medium">
                已補 {report.filled} 筆
                {report.review > 0 && ` · 需人工確認 ${report.review} 筆`}
                {report.notFound > 0 && ` · 查無資料 ${report.notFound} 筆`}
              </p>
              {!report.memberLookupOk && (
                <p className="mb-2 text-amber-700">
                  ⚠️ 會員資料這次查詢失敗，本次只比對了上課記錄卡與訂單名單。
                </p>
              )}
              {report.rows
                .filter((r) => r.status === "FILLED")
                .map((r) => (
                  <div key={r.requestId} className="text-green-700">
                    ✓ {r.name ?? r.email} → {formatMobile(r.phone ?? null)}
                    <span className="ml-1 text-gray-400">
                      （{r.candidates[0]?.source}）
                    </span>
                  </div>
                ))}
              {report.rows
                .filter((r) => r.status === "REVIEW")
                .map((r) => (
                  <div key={r.requestId} className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-amber-900">
                    <div className="font-medium">⚠️ {r.name ?? r.email}｜沒有自動補</div>
                    <div>{r.reason}</div>
                    {r.candidates.map((c, i) => (
                      <div key={i} className="text-gray-600">
                        　查到 {formatMobile(c.phone)}，該筆資料的姓名是「
                        {c.sourceName ?? "（空白）"}」（{c.source}）
                      </div>
                    ))}
                    <div className="mt-0.5 text-gray-500">
                      確認是本人的話，用名單那列的「編輯」手動填入。
                    </div>
                  </div>
                ))}
              {report.notFound > 0 && (
                <p className="mt-1.5 text-gray-500">
                  查無資料（不是會員、也沒買過課，只能請本人自己補）：
                  {report.rows
                    .filter((r) => r.status === "NOT_FOUND")
                    .map((r) => r.name ?? r.email)
                    .join("、")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}


export type BlockedAttemptRow = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  createdAt: string;
};

/** 被蜜罐擋下的索取嘗試：這些人多半**看過一次「已寄出」**卻什麼也沒收到。
 *
 *  為什麼要擺在管理員眼前而不是靜靜記在資料庫：這批人自己不會知道要再試一次
 *  （他們以為登記好了），除非有人主動看到並補寄，否則就是無聲流失一個報名。
 *  2026-09-03 與 2026-09-08 各有一起，後者是本人傳成功截圖來問才發現的。 */
export function BlockedAttempts({ rows }: { rows: BlockedAttemptRow[] }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const remaining = rows.filter((r) => !done[r.id]);
  if (remaining.length === 0 && Object.keys(done).length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
      <p className="mb-1 font-bold text-amber-900">
        ⚠️ 有 {remaining.length} 筆送出被防機器人擋下
      </p>
      <p className="mb-2 text-amber-800">
        這些人在登記頁按了送出、<strong>畫面顯示「已寄出」</strong>，但系統沒有寄信也沒有留名單
        ——多半是密碼管理器填到了隱藏欄位，不是機器人。按「補寄連結信」會寄出與正常登記
        一模一樣的信並補進名單；確認是機器人再按「忽略」。
      </p>
      {remaining.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-amber-200 py-1.5">
          <span className="font-medium text-amber-900">{r.name || "（未填姓名）"}</span>
          <span className="font-mono text-amber-800">{r.email || "（未填 Email）"}</span>
          {r.phone && <span className="text-amber-700">{formatMobile(r.phone)}</span>}
          <span className="text-amber-600">
            {new Date(r.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={pending || !r.email}
            title={r.email ? "寄出與正常登記完全相同的連結信，並補進索取名單" : "沒有 Email，無法補寄"}
            onClick={() =>
              start(async () => {
                const res = await resendBlockedWebinarAttemptAction(r.id);
                setDone((d) => ({ ...d, [r.id]: res?.error ?? res?.success ?? "已處理" }));
              })
            }
            className="rounded border border-amber-500 bg-white px-2 py-0.5 text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
          >
            ✉️ 補寄連結信
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await dismissBlockedWebinarAttemptAction(r.id);
                setDone((d) => ({ ...d, [r.id]: "已忽略" }));
              })
            }
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
          >
            忽略
          </button>
        </div>
      ))}
      {Object.entries(done).map(([id, msg]) => (
        <div key={id} className="border-t border-amber-200 py-1 text-amber-900">
          {msg}
        </div>
      ))}
    </div>
  );
}
