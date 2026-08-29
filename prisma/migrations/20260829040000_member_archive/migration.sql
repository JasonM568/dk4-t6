-- 會員封存只存在 course schema；不修改或刪除共用 auth/public 資料。
CREATE TABLE "MemberArchive" (
  "userId" UUID NOT NULL,
  "reason" TEXT,
  "archivedBy" TEXT,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberArchive_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "MemberArchive_archivedAt_idx" ON "MemberArchive"("archivedAt");
