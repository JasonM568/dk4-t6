export const PERFORMANCE_FILTERS = ["DELIVERED", "CLICKED", "NOT_CLICKED", "INACTIVE"] as const;
export type PerformanceFilter = (typeof PERFORMANCE_FILTERS)[number];

export const PERFORMANCE_FILTER_LABEL: Record<PerformanceFilter, string> = {
  DELIVERED: "已送達",
  CLICKED: "已點擊",
  NOT_CLICKED: "未點擊（排除退信／檢舉）",
  INACTIVE: "未互動（未開信、未點擊，排除退信／檢舉）",
};

export function isPerformanceFilter(value: string): value is PerformanceFilter {
  return (PERFORMANCE_FILTERS as readonly string[]).includes(value);
}

export function resolvePerformanceEmails(
  filter: PerformanceFilter,
  acceptedEmails: string[],
  events: { email: string; type: string }[],
): string[] {
  const accepted = new Set(acceptedEmails);
  const byType = (type: string) => new Set(events.filter((event) => event.type === type && accepted.has(event.email)).map((event) => event.email));
  const bounced = byType("BOUNCED");
  const complained = byType("COMPLAINED");
  const safe = (email: string) => !bounced.has(email) && !complained.has(email);
  if (filter === "DELIVERED") return [...byType("DELIVERED")];
  if (filter === "CLICKED") return [...byType("CLICKED")];
  const clicked = byType("CLICKED");
  if (filter === "NOT_CLICKED") return acceptedEmails.filter((email) => safe(email) && !clicked.has(email));
  const opened = byType("OPENED");
  return acceptedEmails.filter((email) => safe(email) && !opened.has(email) && !clicked.has(email));
}
