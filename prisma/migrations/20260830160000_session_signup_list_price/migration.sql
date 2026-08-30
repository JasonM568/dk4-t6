-- 報名頁價格呈現：原價（劃線顯示用），實收仍為 signupPrice / signupRetrainPrice。
-- 限於 course schema；不觸碰 public / auth。additive。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupListPrice" INTEGER;
