// 課前通知草稿：從場次資料直接長出簡訊與 EDM 的內容，
// 讓「場次看板設完上課資訊 → 一鍵帶到簡訊／EDM 模組」不必再手打一次。
//
// 純函式（無 server-only）：兩個後台頁面各自 import，也方便測試。
//
// 內文一律用 {code} 變數而不是把碼寫死——多選場次時每個人才會拿到自己那場的碼
// （替換規則見 sms/message.ts applySmsMergeTags 與 email/render-content.ts applyMergeTags）。

const LIVE_URL = "course.huangxi.info/live/{code}";

export type NoticeSession = {
  title: string;
  eventDate: Date | null;
  accessCode: string | null;
  meetingUrl: string | null;
  meetingInfo: string | null;
};

/** 台北時間的「8/29」；沒填開課日回 null */
function shortDate(d: Date | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

/** 這場是不是線上課（有連結且有碼才給得出 /live 入口） */
export function isOnlineSession(s: NoticeSession): boolean {
  return !!s.meetingUrl && !!s.accessCode;
}

/** 簡訊草稿。字數是硬限制（中文 70 字/則），所以刻意短：
 *  稱呼＋日期＋一條連結，其餘讓管理員自己加。 */
export function buildClassNoticeSms(s: NoticeSession): string {
  const date = shortDate(s.eventDate);
  const when = date ? `${date} ` : "";
  return isOnlineSession(s)
    ? `{name} 您好，提醒您 ${when}上課。上課連結：${LIVE_URL}`
    : `{name} 您好，提醒您 ${when}上課，請準時出席。`;
}

/** 簡訊草稿的標題（後台識別用，不會出現在簡訊裡） */
export function buildClassNoticeSmsTitle(s: NoticeSession): string {
  const date = shortDate(s.eventDate);
  return `${date ? `${date} ` : ""}${s.title} 課前通知`;
}

/** EDM 草稿。信裡空間夠，把上課資訊寫完整；
 *  課程資料照抄場次設定的那份，兩邊不會各說各話。 */
export function buildClassNoticeEmail(s: NoticeSession): {
  subject: string;
  body: string;
} {
  const date = shortDate(s.eventDate);
  const lines: string[] = [`{name} 您好：`, ""];

  lines.push(
    date
      ? `提醒您報名的「${s.title}」將於 ${date} 開課。`
      : `提醒您報名的「${s.title}」即將開課。`,
  );
  lines.push("");

  if (isOnlineSession(s)) {
    lines.push("## 上課連結");
    lines.push("");
    lines.push(`請於上課前點擊下方按鈕，即可取得 Zoom 連結與課程資料：`);
    lines.push("");
    lines.push(`[取得上課連結](https://${LIVE_URL})`);
    lines.push("");
    lines.push(
      `若按鈕無法點擊，請於瀏覽器開啟 course.huangxi.info/live 並輸入查看碼 {code}。`,
    );
    lines.push("");
  }

  if (s.meetingInfo) {
    lines.push("---");
    lines.push("");
    lines.push("## 課程資料與注意事項");
    lines.push("");
    lines.push(s.meetingInfo);
    lines.push("");
  }

  lines.push("如有任何問題，直接回覆這封信即可。");
  lines.push("");
  lines.push("希望學院");

  return {
    subject: `【上課通知】${date ? `${date} ` : ""}${s.title}`,
    body: lines.join("\n"),
  };
}
