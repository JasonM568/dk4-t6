CREATE TABLE "StudentRecord" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "phone" TEXT,
  "claimedUserId" UUID,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentRecord_email_key" ON "StudentRecord"("email");
CREATE TABLE "StudentCourseHistory" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseName" TEXT NOT NULL,
  "attendedAt" TIMESTAMP(3),
  "source" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCourseHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentCourseHistory_studentId_idx" ON "StudentCourseHistory"("studentId");
ALTER TABLE "StudentCourseHistory" ADD CONSTRAINT "StudentCourseHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
