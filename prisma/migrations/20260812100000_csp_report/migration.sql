-- CSP 違規回報收集（Report-Only 觀察期）
CREATE TABLE "CspReport" (
    "id" TEXT NOT NULL,
    "directive" TEXT NOT NULL,
    "blockedUri" TEXT NOT NULL,
    "documentPath" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CspReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CspReport_directive_blockedUri_documentPath_key"
    ON "CspReport"("directive", "blockedUri", "documentPath");
