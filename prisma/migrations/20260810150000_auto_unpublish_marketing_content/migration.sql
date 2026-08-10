-- 精確的自動下架時間：公開課程與講座到點後不再曝光或接受報名／結帳。
ALTER TABLE "Course" ADD COLUMN "unpublishAt" TIMESTAMP(3);
ALTER TABLE "Webinar" ADD COLUMN "unpublishAt" TIMESTAMP(3);
