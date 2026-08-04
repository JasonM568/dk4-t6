// 發送對象共用 helper：admin actions、dispatch 與後台 UI 都要用
//（actions 檔案是 "use server"，不能 export 同步函式，故獨立成檔——與 followup.ts 同理）

/** 群發紀錄要寄給哪幾個名單群組。
 *
 *  新欄位 groupIds 優先；為空才退回舊的單一 groupId——相容 2026-08 複選改版前
 *  建立的已寄出／排程中／草稿紀錄（migration 已回填，這裡是雙保險）。
 *  回傳保留勾選順序：交集的 email 由排在前面的群組決定姓名（dedupeByEmail 先到先贏）。 */
export function broadcastGroupIds(record: {
  groupIds?: string[] | null;
  groupId?: string | null;
}): string[] {
  const ids = (record.groupIds ?? []).filter((id): id is string => !!id);
  const merged = ids.length > 0 ? ids : record.groupId ? [record.groupId] : [];
  return [...new Set(merged)];
}

/** 複選群組的收件人數試算結果（後台表單即時顯示用）。
 *  型別放這裡而不是 dispatch.ts：dispatch 是 server-only，client component 不該去 import 它。 */
export type GroupAudiencePreview = {
  groups: { id: string; name: string; rowCount: number }[]; // 各群組筆數（未去重）
  missingCount: number; // 勾選了但已被刪除的群組數
  totalRows: number; // 各群組筆數加總
  uniqueCount: number; // 去重後不重複人數
  duplicateCount: number; // totalRows - uniqueCount（跨群組重疊 + 格式不合法者）
  unsubscribedCount: number;
  sendableCount: number; // 實際會寄出的人數
};

/** 一個群組都沒勾時的零值（action 與 UI 共用，避免兩邊各寫一份） */
export const EMPTY_GROUP_AUDIENCE_PREVIEW: GroupAudiencePreview = {
  groups: [],
  missingCount: 0,
  totalRows: 0,
  uniqueCount: 0,
  duplicateCount: 0,
  unsubscribedCount: 0,
  sendableCount: 0,
};
