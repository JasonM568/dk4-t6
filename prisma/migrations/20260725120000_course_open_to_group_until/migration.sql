-- 專區限時免開通觀看：此日期前專區會員不需 Enrollment 即可觀看；null/過期 = 回到手動開通
ALTER TABLE "Course" ADD COLUMN     "openToGroupUntil" TIMESTAMP(3);
