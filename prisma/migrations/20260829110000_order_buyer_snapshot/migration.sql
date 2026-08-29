-- 訂購人快照（姓名/電話），對齊 1shop 訂單介面。限於 course schema。
ALTER TABLE "course"."Order"
  ADD COLUMN "buyerName"  TEXT,
  ADD COLUMN "buyerPhone" TEXT;
