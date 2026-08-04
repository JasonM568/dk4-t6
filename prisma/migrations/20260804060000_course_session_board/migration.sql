-- CreateTable：課程場次看板（場次 + 報名，1shop 訂單匯入歸類）
CREATE TABLE "CourseSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSignup" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "product" TEXT,
    "amount" INTEGER,
    "orderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionSignup_sessionId_orderNo_key" ON "SessionSignup"("sessionId", "orderNo");

-- CreateIndex
CREATE INDEX "SessionSignup_sessionId_idx" ON "SessionSignup"("sessionId");

-- AddForeignKey
ALTER TABLE "SessionSignup" ADD CONSTRAINT "SessionSignup_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
