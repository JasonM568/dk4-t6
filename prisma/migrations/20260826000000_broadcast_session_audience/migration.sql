-- EDM 群發新增「場次報名者」發送對象：一次匯入的場次名單同時給 EDM 與簡訊兩個模組用。
-- 只新增一個有預設值的陣列欄位，既有紀錄（ALL/GROUP/MANUAL/FOLLOWUP）行為完全不變。
-- 欄位語意與 SmsBroadcast.sessionIds 相同：寄出當下才解析名單。

ALTER TABLE "EmailBroadcast" ADD COLUMN "sessionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
