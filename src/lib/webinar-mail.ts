// 講座索取信的內容組裝（純函式，無 server-only）。
//
// 抽出來的理由：後台預覽頁與實際寄信必須走**同一條**組裝路徑。
// 這段邏輯原本內嵌在 requestWebinarLinkAction 裡，預覽若另抄一份，
// 兩邊遲早會不一致——而「預覽跟寄出去的不一樣」比沒有預覽更糟。

import { applyMergeTags, type Recipient } from "./email/render-content";
import { buildJoinUrl } from "./meeting";

/** 組信需要的講座欄位（刻意只收這幾個，避免整包 Webinar 進來） */
export type WebinarMailSource = {
  lectureUrl: string;
  meetingId: string | null;
  meetingPassword: string | null;
  meetingInfo: string | null;
  emailSubject: string;
  emailBody: string;
};

/** 預覽用的假收件人：畫面要看得出 {name}/{email} 帶入後的樣子 */
export const WEBINAR_MAIL_SAMPLE: Recipient = {
  name: "王小明",
  email: "sample@example.com",
};

/** 講座索取信的主旨與內文（未轉 HTML）。
 *
 *  三步：① 內文沒提到連結就自動補 CTA 按鈕 ② {link} 換成帶密碼的進會議連結
 *  ③ 有會議 ID／密碼／補充資訊就在信末附完整資訊區塊（點連結失敗時可手動輸入）。 */
export function buildWebinarMail(
  w: WebinarMailSource,
  recipient: Recipient,
): { subject: string; body: string; joinUrl: string } {
  const joinUrl = buildJoinUrl(w.lectureUrl, w.meetingPassword);

  let body = w.emailBody;
  if (!body.includes("{link}") && !body.includes(w.lectureUrl)) {
    body += `\n\n[▶️ 進入講座]({link})`;
  }
  body = body.replaceAll("{link}", joinUrl);

  const infoLines = [
    w.meetingId && `會議 ID：${w.meetingId}`,
    w.meetingPassword && `會議密碼：${w.meetingPassword}`,
    w.meetingInfo,
  ].filter(Boolean);
  if (infoLines.length > 0) {
    body += `\n\n──────────\n📌 會議資訊\n\n${infoLines.join("\n")}\n\n若點按鈕無法直接進入，請開啟會議程式後手動輸入上方 ID 與密碼。`;
  }

  // 合併變數在最後才套：{name} 若出現在會議資訊裡也一併替換
  return {
    subject: applyMergeTags(w.emailSubject, recipient),
    body: applyMergeTags(body, recipient),
    joinUrl,
  };
}
