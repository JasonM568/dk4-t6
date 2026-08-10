-- 場次行政備忘只供後台管理，不會提供給公開看板。
ALTER TABLE "CourseSession" ADD COLUMN "adminNote" TEXT;
