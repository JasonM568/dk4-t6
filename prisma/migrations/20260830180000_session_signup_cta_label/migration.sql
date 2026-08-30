-- 報名頁導外部模式的 CTA 按鈕文字可自訂（null = 預設「立即報名」）。
-- 限於 course schema；不觸碰 public / auth。additive。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupCtaLabel" TEXT;
