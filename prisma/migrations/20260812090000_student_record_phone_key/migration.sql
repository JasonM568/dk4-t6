-- 學員資料庫改以手機為識別鍵（email 常見夫妻／親子共用，不能當唯一鍵）
-- 執行時正式站與本機的 StudentRecord 皆為 0 筆，無資料轉換需求。
DROP INDEX IF EXISTS "StudentRecord_phone_idx";

ALTER TABLE "StudentRecord" DROP CONSTRAINT IF EXISTS "StudentRecord_email_key";
DROP INDEX IF EXISTS "StudentRecord_email_key";

ALTER TABLE "StudentRecord" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "StudentRecord_phone_key" ON "StudentRecord"("phone");
CREATE INDEX "StudentRecord_email_idx" ON "StudentRecord"("email");
CREATE INDEX "StudentRecord_claimedUserId_idx" ON "StudentRecord"("claimedUserId");
