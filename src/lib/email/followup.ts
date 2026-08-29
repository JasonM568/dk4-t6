// 跟進信共用常數：admin actions 與後台 UI 都要用（actions 檔案是 "use server"，不能 export 常數）

export const FOLLOWUP_FILTERS = [
  "OPENED",
  "NOT_OPENED",
  "CLICKED",
  "OPENED_NOT_CLICKED",
] as const;
export type FollowUpFilter = (typeof FOLLOWUP_FILTERS)[number];

export const FOLLOWUP_FILTER_LABEL: Record<FollowUpFilter, string> = {
  OPENED: "開信者",
  NOT_OPENED: "未開信者",
  CLICKED: "點擊者",
  OPENED_NOT_CLICKED: "開信未點擊", // 看了但沒行動的猶豫名單
};

export function isFollowUpFilter(v: string): v is FollowUpFilter {
  return (FOLLOWUP_FILTERS as readonly string[]).includes(v);
}

/** 從 provider 已接受的母集合解析跟進對象。
 * FAILED/PENDING 不在 acceptedEmails 內，因此即使有異常 webhook 事件也不會混入跟進信。 */
export function resolveFollowUpEmails(
  filter: FollowUpFilter,
  acceptedEmails: string[],
  events: { email: string; type: string }[],
): string[] {
  const accepted = new Set(acceptedEmails);
  const byType = (type: string) =>
    new Set(
      events
        .filter((event) => event.type === type && accepted.has(event.email))
        .map((event) => event.email),
    );
  const opened = byType("OPENED");
  const clicked = byType("CLICKED");

  if (filter === "OPENED") return [...opened];
  if (filter === "CLICKED") return [...clicked];
  if (filter === "OPENED_NOT_CLICKED") {
    return [...opened].filter((email) => !clicked.has(email));
  }

  const bounced = byType("BOUNCED");
  return acceptedEmails.filter(
    (email) => !opened.has(email) && !bounced.has(email),
  );
}
