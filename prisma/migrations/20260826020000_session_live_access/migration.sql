-- 線上場次憑碼索取會議連結（/live）。
-- 全部新增可為 NULL 的欄位，既有場次一筆都不受影響（accessCode 為 NULL = 這場沒開放索取）。
-- accessCode 唯一：一組碼只會對到一個場次，學員輸入碼看不到別場的連結。
-- Postgres 的唯一索引允許多個 NULL，所以沒設碼的場次不會互相衝突。

ALTER TABLE "CourseSession" ADD COLUMN "accessCode" TEXT;
ALTER TABLE "CourseSession" ADD COLUMN "meetingUrl" TEXT;
ALTER TABLE "CourseSession" ADD COLUMN "meetingId" TEXT;
ALTER TABLE "CourseSession" ADD COLUMN "meetingPassword" TEXT;
ALTER TABLE "CourseSession" ADD COLUMN "meetingInfo" TEXT;

CREATE UNIQUE INDEX "CourseSession_accessCode_key" ON "CourseSession"("accessCode");
