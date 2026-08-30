-- 場次自動新舊生定價（PLATFORM 模式）：複訓價 + 複訓資格課程。
-- 限於 course schema；不觸碰 public / auth。全 additive，無 DROP。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupRetrainPrice" INTEGER,
  ADD COLUMN "signupRetrainCourseIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
