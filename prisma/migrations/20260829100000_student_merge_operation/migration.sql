-- 人工合併操作單：保留完整快照與還原狀態，不對已刪除的來源學員卡建立 FK。
CREATE TABLE "StudentMergeOperation" (
  "id" TEXT NOT NULL,
  "sourceStudentId" TEXT NOT NULL,
  "targetStudentId" TEXT NOT NULL,
  "actorEmail" TEXT,
  "snapshotJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "restoredAt" TIMESTAMP(3),
  "restoredBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentMergeOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentMergeOperation_targetStudentId_status_createdAt_idx"
  ON "StudentMergeOperation"("targetStudentId", "status", "createdAt");
CREATE INDEX "StudentMergeOperation_sourceStudentId_createdAt_idx"
  ON "StudentMergeOperation"("sourceStudentId", "createdAt");
