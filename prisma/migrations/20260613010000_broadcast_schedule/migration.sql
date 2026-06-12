-- AlterTable：群發通知加排程欄位（既有資料列 status 維持預設 'SENT'）
ALTER TABLE "EmailBroadcast" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE "EmailBroadcast" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "EmailBroadcast" ADD COLUMN "sentAt" TIMESTAMP(3);
