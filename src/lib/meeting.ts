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
