-- EDM 比照簡訊模組區分「行銷推播 / 履約通知」。
-- 預設 MARKETING = 現行行為（退訂名單全擋），既有紀錄一筆都不會改變行為。
-- NOTICE 只用於已報名學員的課前通知，退訂過濾改為只擋 BOUNCE / COMPLAINT。

ALTER TABLE "EmailBroadcast" ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'MARKETING';
ALTER TABLE "EmailBroadcast" ADD COLUMN "noticeAckBy" TEXT;
