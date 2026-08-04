-- ── 簡訊模組 第一階段：架構與上課提醒 ──────────────────────────
-- 設計對照 EmailBroadcast：所有關聯皆為軟連結不加 FK，場次被刪除時歷史發送紀錄仍完整保留。
-- 名單於「發送當下」才解析（同 EDM 規則），這裡只存發送對象的描述。
-- 金額欄位存「分」而非「元」：簡訊單價低於 NT$1，存整數元會全部四捨五入成 0 或 1。

-- CreateTable
CREATE TABLE "SmsBroadcast" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'NOTICE',
    "audienceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceLabel" TEXT,
    "manualRows" JSONB,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "noMobileCount" INTEGER NOT NULL DEFAULT 0,
    "segments" INTEGER NOT NULL DEFAULT 0,
    "actualSegments" INTEGER NOT NULL DEFAULT 0,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedRecipients" JSONB,
    "resendOfId" TEXT,
    "sentBy" TEXT,
    "noticeAckBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：cron 撈到期排程
CREATE INDEX "SmsBroadcast_status_scheduledAt_idx" ON "SmsBroadcast"("status", "scheduledAt");

-- CreateIndex：每日則數上限的加總查詢
CREATE INDEX "SmsBroadcast_sentAt_idx" ON "SmsBroadcast"("sentAt");

-- CreateTable：簡訊退訂／無法送達名單
-- source：USER（自行退訂）| MANUAL（客服代退）| INVALID（空號/停用）| PROVIDER（業者回報）
-- 與 MailUnsubscribe 的關鍵差異：行銷退訂不得擋掉已報名學員的上課提醒（那是履約通知），
-- 所以過濾時要看 source，不是看有沒有這筆資料。
CREATE TABLE "SmsOptOut" (
    "mobile" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("mobile")
);
