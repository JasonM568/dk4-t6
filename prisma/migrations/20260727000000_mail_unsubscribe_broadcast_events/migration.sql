-- CreateTable：退訂名單（email 一律小寫；source = USER/BOUNCE/COMPLAINT）
CREATE TABLE "MailUnsubscribe" (
    "email" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailUnsubscribe_pkey" PRIMARY KEY ("email")
);

-- CreateTable：群發成效事件（Resend webhook 回流；type = DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED）
CREATE TABLE "BroadcastEvent" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：同一群發+email+事件型別唯一 → 唯一開信/點擊計數天然去重
CREATE UNIQUE INDEX "BroadcastEvent_broadcastId_email_type_key" ON "BroadcastEvent"("broadcastId", "email", "type");
CREATE INDEX "BroadcastEvent_broadcastId_idx" ON "BroadcastEvent"("broadcastId");

-- AlterTable：群發紀錄記「本次排除的退訂數」（明細頁顯示用）
ALTER TABLE "EmailBroadcast" ADD COLUMN "excludedCount" INTEGER NOT NULL DEFAULT 0;
