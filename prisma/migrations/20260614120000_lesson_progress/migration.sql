-- CreateTable：觀看時長——每位學員每章節的累積實看秒數（LessonProgress）
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "lessonId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "watchedSec" INTEGER NOT NULL DEFAULT 0,
    "lastPositionSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_userId_lessonId_key" ON "LessonProgress"("userId", "lessonId");
CREATE INDEX "LessonProgress_userId_idx" ON "LessonProgress"("userId");
CREATE INDEX "LessonProgress_courseId_idx" ON "LessonProgress"("courseId");
CREATE INDEX "LessonProgress_lessonId_idx" ON "LessonProgress"("lessonId");

-- AddForeignKey：章節刪除時連帶清除進度（與 Lesson onDelete: Cascade 對齊）
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
