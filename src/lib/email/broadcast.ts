import "server-only";

import { buildOneClickUnsubscribeUrl } from "./unsubscribe";

// 群發通知：走 Resend API（與 Supabase Auth 信共用同一個 Resend 帳號/網域）。
// 需要環境變數：
//   RESEND_API_KEY  — Resend 的 API Key（re_ 開頭）
//   EMAIL_FROM      — 寄件人，如：希望學院 <no-reply@huibang.com.tw>

// RESEND_BATCH_URL 可用環境變數覆寫，僅供本機 mock 測試 retry 邏輯
const RESEND_BATCH_URL =
  process.env.RESEND_BATCH_URL ?? "https://api.resend.com/emails/batch";
const BATCH_SIZE = 100; // Resend batch 單次上限
const MAX_ATTEMPTS = 3; // 初次 + 2 次重試（僅 429/5xx/網路錯誤）
const BACKOFF_BASE_MS = 2_000; // 指數退避：2s → 4s
const RETRY_AFTER_CAP_MS = 10_000; // 429 Retry-After 上限
const FETCH_TIMEOUT_MS = 15_000;
const INTER_BATCH_DELAY_MS = 600; // Resend 限速 2 req/sec，批間留餘裕

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BroadcastCourse = {
  title: string;
  slug: string;
  coverImage: string | null;
  price: number;
  listPrice: number | null;
};

export type Recipient = { email: string; name?: string };

// 合併變數：在「原文」階段替換，之後 buildBroadcastHtml 內的 esc() 會轉義 → 不會注入。
// 支援 {email}＝收件人 email、{name}＝姓名（無姓名者留空）。
export function applyMergeTags(text: string, r: Recipient): string {
  return text.replaceAll("{email}", r.email).replaceAll("{name}", r.name ?? "");
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const FONT_STACK =
  "-apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif";

// 內文 CTA 按鈕語法：[按鈕文字](https://網址)；只接受 http(s)，樣式與課程卡按鈕一致
const BUTTON_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** 段落原文 → 段落內 HTML：
 *  ① 先抽出按鈕語法存 placeholder（\u0000BTNn\u0000，esc 不會動到）
 *  ② 其餘文字 esc() 轉義（防注入的唯一入口，順序不可調換）
 *  ③ 已轉義文字上把明文網址轉 <a>（href 用轉義後字串即合法 HTML attr；
 *     結尾中英文標點不納入網址）
 *  ④ 回填按鈕 HTML；換行轉 <br />
 *  明文網址與按鈕都是真 <a> 標籤 → Resend 點擊追蹤可改寫、點擊事件可回流 */
function renderParagraph(p: string): string {
  const buttons: string[] = [];
  const withPlaceholders = p.replace(BUTTON_RE, (_m, label: string, url: string) => {
    const idx =
      buttons.push(
        `<a href="${esc(url)}" target="_blank" style="display: inline-block; margin: 4px 0; padding: 12px 36px; background: linear-gradient(135deg, #b71c1c, #d32f2f); background-color: #d32f2f; font-family: ${FONT_STACK}; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">${esc(label.trim())}</a>`,
      ) - 1;
    return `\u0000BTN${idx}\u0000`;
  });
  let html = esc(withPlaceholders);
  // 網址遇到空白/CJK 字元（中文、全形標點——實務網址不含）即截斷，結尾半形標點不納入
  html = html.replace(/https?:\/\/[^\s<\u0000\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]+/g, (m) => {
    const url = m.replace(/[).,;:!?]+$/, "");
    const trail = m.slice(url.length);
    return `<a href="${url}" target="_blank" style="color: #b71c1c; word-break: break-all;">${url}</a>${trail}`;
  });
  html = html.replace(/\u0000BTN(\d+)\u0000/g, (_m, i: string) => buttons[Number(i)] ?? "");
  return html.replaceAll("\n", "<br />");
}

/** 希望學院品牌信 HTML（與重置密碼信同視覺）；內文純文字自動分段，
 *  支援明文網址自動轉連結與 [按鈕文字](網址) CTA 按鈕。
 *  unsubscribeUrl 有值時 footer 加「取消訂閱」連結 */
export function buildBroadcastHtml(
  bodyText: string,
  course: BroadcastCourse | null,
  unsubscribeUrl?: string | null,
): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.9; color: #444444;">${renderParagraph(p.trim())}</p>`,
    )
    .join("");

  const courseBlock = course
    ? `
            <tr>
              <td style="padding: 0 40px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #ecdfc2; border-radius: 12px; overflow: hidden;">
                  ${
                    course.coverImage
                      ? `<tr><td><img src="${esc(course.coverImage)}" width="100%" alt="${esc(course.title)}" style="display: block; width: 100%; border: 0;" /></td></tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding: 20px 24px;">
                      <p style="margin: 0 0 6px; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 17px; font-weight: bold; color: #1a1a1a;">${esc(course.title)}</p>
                      <p style="margin: 0 0 16px; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 15px; color: #b71c1c;">
                        ${
                          course.listPrice && course.listPrice > course.price
                            ? `<span style="color: #999999; text-decoration: line-through; font-size: 13px;">NT$ ${course.listPrice.toLocaleString()}</span>&nbsp; `
                            : ""
                        }<strong>NT$ ${course.price.toLocaleString()}</strong>
                      </p>
                      <a href="${base}/courses/${esc(course.slug)}" target="_blank" style="display: inline-block; padding: 12px 36px; background: linear-gradient(135deg, #b71c1c, #d32f2f); background-color: #d32f2f; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">查看課程</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : "";

  return `<html>
  <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border: 1px solid #c9a24b; border-radius: 12px; overflow: hidden;">
            <tr>
              <td style="height: 4px; background: linear-gradient(90deg, #c9a24b, #f5d77a, #c9a24b); background-color: #c9a24b; font-size: 0; line-height: 0;">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="background: linear-gradient(135deg, #b71c1c 0%, #d32f2f 60%, #e53935 100%); background-color: #d32f2f; padding: 28px 24px 24px;">
                <img src="${base}/brand/hope-academy-logo-email.jpg" width="80" height="80" alt="希望學院 HOPE Academy" style="display: block; width: 80px; height: 80px; border-radius: 50%; border: 0;" />
                <p style="margin: 12px 0 0; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 18px; font-weight: bold; color: #ffffff; letter-spacing: 2px;">希望學院</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 40px 12px;">${paragraphs}</td>
            </tr>
            ${courseBlock}
            <tr>
              <td align="center" style="background-color: #faf7f0; border-top: 1px solid #ecdfc2; padding: 18px 40px;">
                <p style="margin: 0; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 12px; line-height: 1.8; color: #999999;">
                  此信由希望學院學習平台寄出 · <a href="${base}" style="color: #999999;">course.huangxi.info</a><br />
                  &copy; 希望學院 HOPE Academy${
                    unsubscribeUrl
                      ? `<br />不想再收到這類信件？<a href="${esc(unsubscribeUrl)}" style="color: #999999; text-decoration: underline;">取消訂閱</a>`
                      : ""
                  }
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type FailedRecipient = { email: string; name?: string; reason: string };
export type SendResult = {
  sent: number;
  failed: number;
  error?: string;
  failedRecipients: FailedRecipient[];
};

/** 429/5xx/網路錯誤自動退避重試；其他 4xx 不重試直接回傳失敗 response */
async function postBatchWithRetry(
  apiKey: string,
  body: string,
): Promise<Response | { networkError: string }> {
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      lastNetworkError = e instanceof Error ? e.message : String(e);
      console.error(
        `[email/broadcast] 批次網路錯誤（第 ${attempt} 次）：`,
        lastNetworkError,
      );
    }

    if (res) {
      const retryable = res.status === 429 || res.status >= 500;
      if (res.ok || !retryable) return res;
      if (attempt < MAX_ATTEMPTS) {
        // 429 優先尊重 Retry-After（秒），否則指數退避
        const retryAfterSec = Number(res.headers.get("retry-after"));
        const waitMs =
          res.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, RETRY_AFTER_CAP_MS)
            : BACKOFF_BASE_MS * 2 ** (attempt - 1);
        console.error(
          `[email/broadcast] Resend ${res.status}，${waitMs}ms 後重試（第 ${attempt}/${MAX_ATTEMPTS} 次）`,
        );
        await sleep(waitMs);
        continue;
      }
      return res; // 用盡重試，回傳最後的失敗 response
    }

    // 網路錯誤：還有次數就退避重試
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
  }
  return { networkError: lastNetworkError || "連線失敗" };
}

export type SendOptions = {
  broadcastId?: string; // 有值時每封帶 tag，供 Resend webhook 事件回流對應群發紀錄
  withUnsubscribe?: boolean; // 有值時每封帶 List-Unsubscribe one-click headers（RFC 8058）
};

/** 以 Resend batch API 寄送（每批 100 封）；html 逐封產生，支援每位收件人不同內容 */
export async function sendBroadcast(
  recipients: Recipient[],
  subject: string,
  renderHtml: (r: Recipient) => string,
  options?: SendOptions,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    const reason = "尚未設定 RESEND_API_KEY / EMAIL_FROM 環境變數";
    return {
      sent: 0,
      failed: recipients.length,
      error: reason,
      failedRecipients: recipients.map((r) => ({
        email: r.email,
        ...(r.name ? { name: r.name } : {}),
        reason,
      })),
    };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  const failedRecipients: FailedRecipient[] = [];
  const failChunk = (chunk: Recipient[], reason: string) => {
    failed += chunk.length;
    for (const r of chunk) {
      failedRecipients.push({
        email: r.email,
        ...(r.name ? { name: r.name } : {}),
        reason,
      });
    }
    if (!firstError) firstError = reason;
  };

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(INTER_BATCH_DELAY_MS);
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const res = await postBatchWithRetry(
      apiKey,
      JSON.stringify(
        chunk.map((r) => {
          const oneClick = options?.withUnsubscribe
            ? buildOneClickUnsubscribeUrl(r.email)
            : null;
          return {
            from,
            to: [r.email],
            subject,
            html: renderHtml(r),
            ...(oneClick
              ? {
                  headers: {
                    "List-Unsubscribe": `<${oneClick}>`,
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                  },
                }
              : {}),
            ...(options?.broadcastId
              ? { tags: [{ name: "broadcast_id", value: options.broadcastId }] }
              : {}),
          };
        }),
      ),
    );

    if ("networkError" in res) {
      failChunk(chunk, `連線失敗：${res.networkError.slice(0, 200)}`);
      console.error("[email/broadcast] 批次寄送失敗（網路）：", res.networkError);
      continue;
    }

    if (!res.ok) {
      // 不可重試的 4xx，或 429/5xx 用盡重試：整批計為失敗
      const text = await res.text().catch(() => "");
      failChunk(chunk, `Resend ${res.status}：${text.slice(0, 200)}`);
      console.error(
        "[email/broadcast] 批次寄送失敗：",
        `Resend ${res.status}：${text.slice(0, 200)}`,
      );
      continue;
    }

    // HTTP 2xx：解析 batch 回傳 body，逐筆判定真實成功/失敗。
    // 成功時格式為 { data: [{ id }, ...] }；個別退信的元素會帶 error。
    const payload = (await res.json().catch(() => null)) as {
      data?: Array<{ id?: string; error?: unknown } | null>;
    } | null;
    const items = payload?.data;

    if (!Array.isArray(items)) {
      // 回傳格式非預期：保守起見整批計為失敗
      failChunk(chunk, `Resend ${res.status}：回傳格式非預期`);
      console.error("[email/broadcast] 批次回傳格式非預期：", payload);
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const item = items[j];
      if (item && item.id && !item.error) {
        sent += 1;
      } else {
        const errText =
          item && item.error
            ? typeof item.error === "string"
              ? item.error
              : JSON.stringify(item.error)
            : "未取得寄送結果";
        const reason = `Resend 退信：${errText.slice(0, 200)}`;
        failed += 1;
        failedRecipients.push({
          email: chunk[j].email,
          ...(chunk[j].name ? { name: chunk[j].name } : {}),
          reason,
        });
        if (!firstError) firstError = reason;
        console.error("[email/broadcast] 單筆寄送失敗：", chunk[j].email, reason);
      }
    }
  }

  return { sent, failed, error: firstError, failedRecipients };
}
