-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "CourseGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wallText" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" UUID,
    "source" TEXT NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupInviteCode" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupInviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseGroup_slug_key" ON "CourseGroup"("slug");

-- CreateIndex
CREATE INDEX "CourseGroupMember_groupId_idx" ON "CourseGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "CourseGroupMember_email_idx" ON "CourseGroupMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CourseGroupMember_groupId_email_key" ON "CourseGroupMember"("groupId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "GroupInviteCode_code_key" ON "GroupInviteCode"("code");

-- CreateIndex
CREATE INDEX "Course_groupId_idx" ON "Course"("groupId");

-- AddForeignKey
ALTER TABLE "CourseGroupMember" ADD CONSTRAINT "CourseGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteCode" ADD CONSTRAINT "GroupInviteCode_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
