-- 講座索取加收手機（必填，2026-09-02 起）：開課前提醒簡訊與學員記錄卡歸戶都以手機為識別鍵。
-- 欄位可空——上線前既有的索取紀錄沒有手機，補不回來，硬設 NOT NULL 會讓 migration 失敗。
-- 「必填」在表單與 action 層強制，不靠資料庫約束。
-- 限於 course schema；不觸碰 public / auth。純新增欄位，不改動既有資料。

ALTER TABLE "course"."WebinarRequest"
  ADD COLUMN "phone" TEXT;
