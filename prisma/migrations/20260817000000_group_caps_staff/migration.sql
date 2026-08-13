-- 逐組人數上限覆寫＋工作人員名單（不分組、計用餐）
ALTER TABLE "CourseSession" ADD COLUMN "groupCaps" INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE "SessionSignup" ADD COLUMN "isStaff" BOOLEAN NOT NULL DEFAULT false;
