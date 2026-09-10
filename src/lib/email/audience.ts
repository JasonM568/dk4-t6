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

/** 群發紀錄要寄給哪幾個場次（audienceType=SESSION）。
 *
 *  與 sms/audience.ts 的 broadcastSessionIds 同義而刻意各留一份：兩個模組的
 *  audience helper 都是 client component 也會 import 的純模組，不互相牽連。
 *  去重並保留勾選順序——跨場次重複報名的人，姓名由排在前面的場次決定
 *  （dedupeByEmail 先到先贏）。 */
export function broadcastSessionIds(record: {
  sessionIds?: string[] | null;
}): string[] {
  return [...new Set((record.sessionIds ?? []).filter(Boolean))];
}

/** 群發紀錄要寄給哪幾場講座的索取者（audienceType=WEBINAR）。
 *
 *  與 sms/audience.ts 的 broadcastWebinarIds 同義而刻意各留一份，理由同
 *  broadcastSessionIds：兩個模組的 audience helper 是 client component 也會
 *  import 的純模組，不互相牽連。
 *  去重並保留勾選順序——跨講座重複索取的人，姓名由排在前面的講座決定
 *  （dedupeByEmail 先到先贏）。 */
export function broadcastWebinarIds(record: {
  webinarIds?: string[] | null;
}): string[] {
  return [...new Set((record.webinarIds ?? []).filter(Boolean))];
}

/** 複選講座的收件人數試算結果。
 *
 *  刻意與 SessionAudiencePreview 分開而不共用：場次名單有 {code} 上課碼、
 *  講座沒有（連結直接寄信），共用一個型別會留一個永遠是 0 的欄位在畫面上，
 *  日後看的人分不清那是「沒設碼」還是「這種名單本來就沒有」。 */
export type WebinarAudiencePreview = {
  webinars: { id: string; title: string; rowCount: number }[]; // 各講座筆數（未去重）
  missingCount: number; // 勾選了但已被刪除的講座數
  totalRows: number;
  noEmailCount: number; // 沒填 email／格式不合法（這些人收不到）
  uniqueCount: number; // 去重後不重複人數
  duplicateCount: number; // 跨講座重複索取的筆數
  unsubscribedCount: number;
  sendableCount: number;
};

export const EMPTY_WEBINAR_AUDIENCE_PREVIEW: WebinarAudiencePreview = {
  webinars: [],
  missingCount: 0,
  totalRows: 0,
  noEmailCount: 0,
  uniqueCount: 0,
  duplicateCount: 0,
  unsubscribedCount: 0,
  sendableCount: 0,
};

/** 複選場次的收件人數試算結果。
 *  與 GroupAudiencePreview 分開：場次名單多了「沒有 email 收不到」這個必須讓操作者看到的數字
 *  （團報名單常常只有訂購人 email，同行者是空的）。 */
export type SessionAudiencePreview = {
  sessions: { id: string; title: string; rowCount: number }[]; // 各場次筆數（未去重）
  missingCount: number; // 勾選了但已被刪除的場次數
  totalRows: number;
  noEmailCount: number; // 沒填 email／格式不合法（這些人收不到，要改用簡訊或補資料）
  uniqueCount: number; // 去重後不重複人數
  duplicateCount: number; // 跨場次重複報名的筆數
  unsubscribedCount: number;
  sendableCount: number;
  /** 名單中有幾個人拿得到 {code}（所屬場次已設上課碼）。
   *  內文用了 {code} 但這個數字小於可寄人數 = 有人會收到一封沒有碼的信。 */
  withCodeCount: number;
};

export const EMPTY_SESSION_AUDIENCE_PREVIEW: SessionAudiencePreview = {
  sessions: [],
  missingCount: 0,
  totalRows: 0,
  noEmailCount: 0,
  uniqueCount: 0,
  duplicateCount: 0,
  unsubscribedCount: 0,
  sendableCount: 0,
  withCodeCount: 0,
};

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
