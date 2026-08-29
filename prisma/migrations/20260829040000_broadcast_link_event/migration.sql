-- EDM Phase 2：逐連結點擊彙總與 webhook 重送收據（皆為歷史軟連結，不設 FK）
CREATE TABLE "BroadcastLinkEvent" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "firstClickedAt" TIMESTAMP(3) NOT NULL,
    "lastClickedAt" TIMESTAMP(3) NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastLinkEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "svixId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BroadcastLinkEvent_broadcastId_email_urlHash_key"
ON "BroadcastLinkEvent"("broadcastId", "email", "urlHash");

CREATE INDEX "BroadcastLinkEvent_broadcastId_lastClickedAt_idx"
ON "BroadcastLinkEvent"("broadcastId", "lastClickedAt");

CREATE UNIQUE INDEX "WebhookReceipt_svixId_key" ON "WebhookReceipt"("svixId");
