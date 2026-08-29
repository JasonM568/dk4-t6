-- 會員姓名（結帳前必填）。限於 course schema。
ALTER TABLE "course"."MemberProfile" ADD COLUMN "name" TEXT;
