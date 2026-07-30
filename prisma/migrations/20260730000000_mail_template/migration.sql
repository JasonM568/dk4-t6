-- CreateTable：EDM 範本（常用信件內容存檔，群發表單一鍵帶入）
-- 只存內容（主旨/內文/關聯課程），發送對象每次寄送時自行選擇
-- courseId 為軟連結不加 FK，與 EmailBroadcast.courseId 慣例一致
CREATE TABLE "MailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "courseId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailTemplate_name_key" ON "MailTemplate"("name");
