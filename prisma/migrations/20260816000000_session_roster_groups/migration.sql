-- 場次學員統計/分組：葷素、組別、延期標記、每組人數上限
ALTER TABLE "CourseSession" ADD COLUMN "groupCap" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "SessionSignup" ADD COLUMN "meal" TEXT;
ALTER TABLE "SessionSignup" ADD COLUMN "groupNo" INTEGER;
ALTER TABLE "SessionSignup" ADD COLUMN "deferredToSessionId" TEXT;
ALTER TABLE "SessionSignup" ADD COLUMN "deferredFromSessionId" TEXT;
