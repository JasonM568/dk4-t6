-- 簡訊逐筆發送紀錄（追蹤送達／失敗／拒收）
-- 只新增：CREATE TABLE + 一個有預設值的欄位，不改動任何既有欄位

CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "name" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "segments" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsMessage_providerMessageId_key" ON "SmsMessage"("providerMessageId");
CREATE INDEX "SmsMessage_broadcastId_idx" ON "SmsMessage"("broadcastId");
CREATE INDEX "SmsMessage_status_idx" ON "SmsMessage"("status");

ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "SmsBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmsBroadcast" ADD COLUMN "deliveredCount" INTEGER NOT NULL DEFAULT 0;
