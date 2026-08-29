-- 學員名單優化：舊官網狀態、潛在接觸紀錄與維護稽核。
-- 全部為 additive；不修改 auth/public schema，也不變更既有觀看權限。
ALTER TABLE "StudentRecord"
  ADD COLUMN "legacyAccessStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "legacyNote" TEXT;

CREATE TABLE "StudentEngagement" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "source" TEXT,
  "sourceRef" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentEngagement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentEngagement_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "StudentRecord"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StudentEngagement_studentId_idx" ON "StudentEngagement"("studentId");
CREATE INDEX "StudentEngagement_type_idx" ON "StudentEngagement"("type");

CREATE TABLE "StudentDataAuditLog" (
  "id" TEXT NOT NULL,
  "studentId" TEXT,
  "historyId" TEXT,
  "action" TEXT NOT NULL,
  "actorEmail" TEXT,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentDataAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentDataAuditLog_studentId_createdAt_idx"
  ON "StudentDataAuditLog"("studentId", "createdAt");
CREATE INDEX "StudentDataAuditLog_createdAt_idx" ON "StudentDataAuditLog"("createdAt");
