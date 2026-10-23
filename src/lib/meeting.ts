// 會議連結組裝：講座（Webinar）與線上場次（CourseSession → /live）共用。
// 兩邊各寫一份的話，Zoom 的 pwd 慣例遲早只有一邊修對。

/** 進會議連結：有密碼且連結本身沒帶 pwd 參數時，自動附加 ?pwd=（Zoom 慣例）。
 *  若邀請連結原本就含加密 pwd，直接沿用不動；不是合法網址就原樣回傳。 */
export function buildJoinUrl(
  meetingUrl: string,
  meetingPassword?: string | null,
): string {
  if (!meetingPassword) return meetingUrl;
  try {
    const url = new URL(meetingUrl);
    if (url.searchParams.has("pwd")) return meetingUrl;
    url.searchParams.set("pwd", meetingPassword);
    return url.toString();
  } catch {
    return meetingUrl;
  }
}

/** 會議補充資訊要上「公開」活動資訊頁時先過這一層：
 *  管理員習慣把整段 Zoom 邀請貼進這欄（2026-10-24 正式站 10/28 那頁就是：網址＋ID＋密碼全在裡面），
 *  這欄原本只進信件所以沒事；公開頁只能留「時間／注意事項」這類行。
 *  逐行判斷，整行丟掉：含網址、含密碼／pwd／passcode 字樣、含會議 ID 字樣、或含 9 碼以上連續數字（Zoom ID）。 */
export function publicMeetingNotes(info: string | null | undefined): string {
  if (!info) return "";
  const kept = info
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // 空行保留，維持段落
      if (/https?:\/\/|www\./i.test(t)) return false;
      if (/pwd|passcode|password|密碼/i.test(t)) return false;
      if (/meeting\s*id|會議\s*id|會議號|會議編號/i.test(t)) return false;
      if (/\d[\d\s-]{8,}\d/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return kept;
}

/** 只放行 http(s)：會議連結是後台自由輸入，直接渲染成 <a href> 前必須擋掉
 *  javascript:／data: 這類 scheme，否則就是一個 XSS 入口。 */
export function isSafeHttpUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
