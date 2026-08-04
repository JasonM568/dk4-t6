-- CreateTable：講座報名頁（訪客輸入 email 索取講座連結信）
CREATE TABLE "Webinar" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lectureUrl" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "emailBody" TEXT NOT NULL,
    "groupId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webinar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebinarRequest" (
    "id" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebinarRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Webinar_slug_key" ON "Webinar"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WebinarRequest_webinarId_email_key" ON "WebinarRequest"("webinarId", "email");

-- CreateIndex
CREATE INDEX "WebinarRequest_webinarId_idx" ON "WebinarRequest"("webinarId");

-- AddForeignKey
ALTER TABLE "WebinarRequest" ADD CONSTRAINT "WebinarRequest_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "Webinar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
