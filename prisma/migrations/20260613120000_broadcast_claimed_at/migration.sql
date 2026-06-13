-- AlterTable：群發排程加認領時間（回收逾時卡在 SENDING 的寄送）
ALTER TABLE "EmailBroadcast" ADD COLUMN "claimedAt" TIMESTAMP(3);
