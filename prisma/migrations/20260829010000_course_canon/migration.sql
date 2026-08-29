-- 課名歸戶：標準課程主檔 + 課名原文對照（完整原文比對）
CREATE TABLE "CanonicalCourse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COURSE',
    "level" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalCourse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalCourse_name_key" ON "CanonicalCourse"("name");

CREATE TABLE "StudentCourseAlias" (
    "rawName" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCourseAlias_pkey" PRIMARY KEY ("rawName")
);

CREATE INDEX "StudentCourseAlias_courseId_idx" ON "StudentCourseAlias"("courseId");

ALTER TABLE "StudentCourseAlias" ADD CONSTRAINT "StudentCourseAlias_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "CanonicalCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
