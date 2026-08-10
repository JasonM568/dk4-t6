CREATE TABLE "DailyBrief" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "coverVariant" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyBrief_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyBriefImage" (
  "id" TEXT NOT NULL,
  "briefId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyBriefImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyBrief_groupId_dateKey_key" ON "DailyBrief"("groupId", "dateKey");
CREATE INDEX "DailyBrief_groupId_status_dateKey_idx" ON "DailyBrief"("groupId", "status", "dateKey");
CREATE INDEX "DailyBriefImage_briefId_sortOrder_idx" ON "DailyBriefImage"("briefId", "sortOrder");

ALTER TABLE "DailyBrief" ADD CONSTRAINT "DailyBrief_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CourseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyBriefImage" ADD CONSTRAINT "DailyBriefImage_briefId_fkey"
  FOREIGN KEY ("briefId") REFERENCES "DailyBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;
