-- 結帳防重原子鍵：PENDING 訂單持有 "userId:courseId"，離開 PENDING 清 null。
-- nullable unique index（PG 允許多個 NULL）→ 同 user 同課程同時最多一筆有效 PENDING。

ALTER TABLE "Order" ADD COLUMN "checkoutKey" TEXT;

-- 回填既有 PENDING：同 user 同課程若有多筆歷史重複，只讓最新一筆持鍵，
-- 其餘維持 NULL（不動狀態，交給結帳時的 lazy 逾期轉換收斂）
UPDATE "Order" o
SET "checkoutKey" = sub.key
FROM (
  SELECT DISTINCT ON (o2."userId", i."courseId")
    o2.id,
    o2."userId" || ':' || i."courseId" AS key
  FROM "Order" o2
  JOIN "OrderItem" i ON i."orderId" = o2.id
  WHERE o2.status = 'PENDING'
  ORDER BY o2."userId", i."courseId", o2."createdAt" DESC
) sub
WHERE sub.id = o.id;

-- 回填完才建 unique index，避免歷史重複資料撞索引
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");
