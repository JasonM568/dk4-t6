// 標準課程（課名歸戶）的 kind / level 值域與顯示標籤，歸戶管理頁與記錄卡共用。
// 常數不能放 src/actions（"use server" 只准 async export），所以獨立在這裡。

export const COURSE_KIND_LABELS: Record<string, string> = {
  COURSE: "課程",
  SUBSCRIPTION: "訂閱",
  SEMINAR: "講座／分享會",
  EVENT: "見面會活動",
  PRODUCT: "商品",
  OTHER: "其他（折價券、退刷）",
};

export const COURSE_LEVEL_LABELS: Record<string, string> = {
  BASIC: "初階",
  ADVANCED: "進階",
};

/** 記錄卡摘要列只算「真的上過課」的類型；商品、折價券、退刷不算履歷 */
export const HISTORY_KINDS = ["COURSE", "SUBSCRIPTION", "SEMINAR", "EVENT"];
