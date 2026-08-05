// 企業包班諮詢：前台表單選項與後台狀態的共用常數。
// client/server 元件都會 import，不可加 "use server"。

export const INQUIRY_STATUSES = [
  { value: "NEW", label: "新進" },
  { value: "CONTACTED", label: "洽談中" },
  { value: "WON", label: "已成交" },
  { value: "CLOSED", label: "已結案" },
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]["value"];

export function statusLabel(value: string): string {
  return INQUIRY_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export const TOPIC_OPTIONS = [
  "AI 入門體驗",
  "AI 辦公室應用（簡報／文書／報表）",
  "AI 行銷與內容產出",
  "AI 自動化與 Agent 應用",
  "其他／客製主題",
] as const;

export const HEADCOUNT_OPTIONS = [
  "10 人以下",
  "11–20 人",
  "21–50 人",
  "51–100 人",
  "100 人以上",
  "尚未確定",
] as const;

export const TRAINING_TYPE_OPTIONS = [
  "實體授課",
  "線上授課",
  "實體＋線上皆可",
] as const;

export const BUDGET_OPTIONS = [
  "5 萬以下",
  "5–10 萬",
  "10–20 萬",
  "20 萬以上",
  "依提案而定",
] as const;
