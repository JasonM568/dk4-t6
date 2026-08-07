-- 看板自動下架：場次/講座加結束日（全 nullable 零風險）
-- CourseSession.endDate：多日課程的結束日，null = 以 eventDate 為準
-- Webinar.endDate：講座結束日，過了隔天看板下架＋報名頁自動關閉
ALTER TABLE "CourseSession" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "Webinar" ADD COLUMN "endDate" TIMESTAMP(3);
