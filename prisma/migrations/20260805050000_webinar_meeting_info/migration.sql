-- AlterTable：講座會議資訊（ID/密碼/補充資訊，皆 nullable 零風險）
ALTER TABLE "Webinar" ADD COLUMN "meetingId" TEXT;
ALTER TABLE "Webinar" ADD COLUMN "meetingPassword" TEXT;
ALTER TABLE "Webinar" ADD COLUMN "meetingInfo" TEXT;
