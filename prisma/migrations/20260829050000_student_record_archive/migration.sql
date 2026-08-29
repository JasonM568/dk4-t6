-- 歷史學員／潛在名單可復原封存；不刪除任何會員或課程資料。
ALTER TABLE "StudentRecord"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "StudentRecord_archivedAt_idx" ON "StudentRecord"("archivedAt");
