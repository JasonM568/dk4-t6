/** 可以標成履約通知的 UI audience。
 * ALL／GROUP／FOLLOWUP 是電子報血統，不能用 NOTICE 繞過行銷退訂。 */
const NOTICE_ALLOWED_AUDIENCES = new Set(["session", "manual", "members"]);

/** 依表單選項決定郵件類型；不合法組合回傳 error，呼叫端必須中止寄送。 */
export function resolveMessageType(
  audience: string,
  wantsNotice: boolean,
  noticeAck: boolean,
): { messageType: "MARKETING" | "NOTICE"; error?: string } {
  if (!wantsNotice) return { messageType: "MARKETING" };
  if (!NOTICE_ALLOWED_AUDIENCES.has(audience)) {
    return {
      messageType: "MARKETING",
      error:
        "「履約通知」只能用於場次報名者／手動名單／選取會員——" +
        "全部會員與名單群組屬於電子報，必須尊重退訂名單",
    };
  }
  if (!noticeAck) {
    return {
      messageType: "MARKETING",
      error: "請勾選確認這是與已報名學員的履約通知（上課提醒／異動通知）",
    };
  }
  return { messageType: "NOTICE" };
}
