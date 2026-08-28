-- 外部分潤自動歸屬＋收支表模板（純新增欄位，不動既有資料）
-- SessionOrder：存 1shop 的銷售頁名稱／編號前綴／推薦人原文（分潤歸屬與追溯）
-- CourseSession.financeTemplate：QUANTUM / GENERAL / SEMINAR；NULL = 依場次名稱自動判斷
ALTER TABLE "SessionOrder" ADD COLUMN "salesPage" TEXT;
ALTER TABLE "SessionOrder" ADD COLUMN "salesPageCode" TEXT;
ALTER TABLE "SessionOrder" ADD COLUMN "referrer" TEXT;
ALTER TABLE "CourseSession" ADD COLUMN "financeTemplate" TEXT;
