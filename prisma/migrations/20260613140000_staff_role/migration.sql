-- CreateTable：course 平台自管的後台幹部角色（OPERATOR/COACH；admin 沿用 QBC profiles.role）
CREATE TABLE "StaffRole" (
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("userId")
);
