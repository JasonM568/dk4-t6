-- CreateTable：EDM 逐收件人 provider 接受結果（broadcastId 為歷史軟連結，不設 FK）
CREATE TABLE "EmailBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailBroadcastRecipient_broadcastId_email_key"
ON "EmailBroadcastRecipient"("broadcastId", "email");

CREATE INDEX "EmailBroadcastRecipient_broadcastId_status_idx"
ON "EmailBroadcastRecipient"("broadcastId", "status");
