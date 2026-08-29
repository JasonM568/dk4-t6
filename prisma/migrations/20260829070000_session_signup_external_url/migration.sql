-- 報名頁支援「導去外部報名頁（1shop）」模式
-- 有值 = 只當落地頁，顯示 CTA 導出去，不收表單也不管名額。
-- 限於 course schema；不觸碰 public / auth。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupUrl" TEXT;
