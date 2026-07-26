-- AlterTable：跟進信（audienceType=FOLLOWUP）
-- sourceBroadcastId = 來源群發 id（軟連結不加 FK，與 groupId/resendOfId 慣例一致）
-- followUpFilter    = 跟進條件 OPENED / NOT_OPENED / CLICKED（名單於寄出當下解析）
ALTER TABLE "EmailBroadcast" ADD COLUMN "sourceBroadcastId" TEXT;
ALTER TABLE "EmailBroadcast" ADD COLUMN "followUpFilter" TEXT;
