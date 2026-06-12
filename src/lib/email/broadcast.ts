import "server-only";

// 群發通知：走 Resend API（與 Supabase Auth 信共用同一個 Resend 帳號/網域）。
// 需要環境變數：
//   RESEND_API_KEY  — Resend 的 API Key（re_ 開頭）
//   EMAIL_FROM      — 寄件人，如：希望學院 <no-reply@huibang.com.tw>

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_SIZE = 100; // Resend batch 單次上限

export type BroadcastCourse = {
  title: string;
  slug: string;
  coverImage: string | null;
  price: number;
  listPrice: number | null;
};

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 希望學院品牌信 HTML（與重置密碼信同視覺）；內文純文字自動分段 */
export function buildBroadcastHtml(
  bodyText: string,
  course: BroadcastCourse | null,
): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-family: -apple-system, 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif; font-size: 15px; line-height: 1.9; color: #444444;">${esc(p.trim()).replaceAll("\n", "<br />")}</p>`,
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
                  &copy; 希望學院 HOPE Academy
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

export type SendResult = { sent: number; failed: number; error?: string };

/** 以 Resend batch API 寄送（每批 100 封） */
export async function sendBroadcast(
  recipients: string[],
  subject: string,
  html: string,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return {
      sent: 0,
      failed: recipients.length,
      error: "尚未設定 RESEND_API_KEY / EMAIL_FROM 環境變數",
    };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const res = await fetch(RESEND_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        chunk.map((to) => ({ from, to: [to], subject, html })),
      ),
    });

    if (res.ok) {
      sent += chunk.length;
    } else {
      failed += chunk.length;
      if (!firstError) {
        const text = await res.text().catch(() => "");
        firstError = `Resend ${res.status}：${text.slice(0, 200)}`;
        console.error("[email/broadcast] 批次寄送失敗：", firstError);
      }
    }
  }

  return { sent, failed, error: firstError };
}
