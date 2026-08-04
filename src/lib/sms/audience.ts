// 簡訊發送對象的共用型別與零值常數。
// 放這裡而不是 dispatch.ts：dispatch 是 server-only，後台表單（client component）不該 import 它。
//（同 email/audience.ts 的既有做法）

export type SmsRecipient = { mobile: string; name?: string };

/** 手動貼入的名單列（存進 SmsBroadcast.manualRows 的形狀） */
export type SmsManualRow = { mobile: string; name?: string };

export type SmsAudiencePreview = {
  /** 各來源（場次／群組）的原始筆數，未去重 */
  sources: { id: string; label: string; rowCount: number }[];
  missingCount: number; // 勾選了但已被刪除的來源數
  totalRows: number; // 各來源筆數加總
  noMobileCount: number; // 沒填手機、市話、格式錯誤（這些人收不到）
  uniqueCount: number; // 去重後不重複手機數
  duplicateCount: number; // 跨來源重疊的筆數
  optedOutCount: number; // 因退訂／無法送達被排除
  sendableCount: number; // 實際會送出的人數
  maxNameLength: number; // 名單中最長姓名字數；{name} 變數的字數上界估算用
};

export const EMPTY_SMS_AUDIENCE_PREVIEW: SmsAudiencePreview = {
  sources: [],
  missingCount: 0,
  totalRows: 0,
  noMobileCount: 0,
  uniqueCount: 0,
  duplicateCount: 0,
  optedOutCount: 0,
  sendableCount: 0,
  maxNameLength: 0,
};

/** 發送紀錄要發給哪些場次：陣列欄位去重並保留勾選順序
 *  （勾選順序決定跨場次重複的人取哪一筆姓名——dedupeByMobile 先到先贏） */
export function broadcastSessionIds(record: {
  sessionIds?: string[] | null;
}): string[] {
  return [...new Set((record.sessionIds ?? []).filter(Boolean))];
}
