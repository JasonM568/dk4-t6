// 跟進信共用常數：admin actions 與後台 UI 都要用（actions 檔案是 "use server"，不能 export 常數）

export const FOLLOWUP_FILTERS = ["OPENED", "NOT_OPENED", "CLICKED"] as const;
export type FollowUpFilter = (typeof FOLLOWUP_FILTERS)[number];

export const FOLLOWUP_FILTER_LABEL: Record<FollowUpFilter, string> = {
  OPENED: "開信者",
  NOT_OPENED: "未開信者",
  CLICKED: "點擊者",
};

export function isFollowUpFilter(v: string): v is FollowUpFilter {
  return (FOLLOWUP_FILTERS as readonly string[]).includes(v);
}
