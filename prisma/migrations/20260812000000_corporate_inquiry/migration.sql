-- ── 企業包班諮詢 ──
-- /corporate 公開表單的諮詢單。獨立表、無 FK 關聯；
-- status 為軟狀態字串（NEW/CONTACTED/WON/CLOSED），後台名單管理用。

-- CreateTable
CREATE TABLE "CorporateInquiry" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactTitle" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "headcount" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trainingType" TEXT,
    "preferredTime" TEXT,
    "budget" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateInquiry_status_idx" ON "CorporateInquiry"("status");

-- CreateIndex
CREATE INDEX "CorporateInquiry_createdAt_idx" ON "CorporateInquiry"("createdAt");
