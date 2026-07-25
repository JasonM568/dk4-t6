-- AlterTable：EmailBroadcast 加逐筆失敗名單與補寄來源（純 additive）
-- failedRecipients：[{email,name?,reason}]，補寄後更新為仍失敗子集
-- resendOfId：補寄紀錄記來源群發 id（軟連結，不加 FK）
ALTER TABLE "EmailBroadcast" ADD COLUMN "failedRecipients" JSONB;
ALTER TABLE "EmailBroadcast" ADD COLUMN "resendOfId" TEXT;
