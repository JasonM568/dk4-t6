-- CreateTable：待開通名單（批次開通「查無會員」存底，註冊/建帳號當下自動認領開通）
-- userId 為使用者帳號軟連結不加 FK（慣例同 Enrollment.userId）
CREATE TABLE "PendingEnrollment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "userId" UUID,

    CONSTRAINT "PendingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingEnrollment_courseId_email_key" ON "PendingEnrollment"("courseId", "email");

-- CreateIndex
CREATE INDEX "PendingEnrollment_email_idx" ON "PendingEnrollment"("email");

-- AddForeignKey
ALTER TABLE "PendingEnrollment" ADD CONSTRAINT "PendingEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
