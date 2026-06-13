-- CreateTable：管理員設定的會員初始密碼備查（非 Auth 真實密碼）
CREATE TABLE "MemberPassword" (
    "userId" UUID NOT NULL,
    "password" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPassword_pkey" PRIMARY KEY ("userId")
);
