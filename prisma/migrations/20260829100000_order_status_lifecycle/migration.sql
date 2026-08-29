-- 訂單狀態擴充：加入營運生命週期態（待確認/已確認/已完成/已取消）。
-- 既有值與資料不動。限於 course schema；不觸碰 public / auth。
ALTER TYPE "course"."OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_CONFIRM';
ALTER TYPE "course"."OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "course"."OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "course"."OrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
