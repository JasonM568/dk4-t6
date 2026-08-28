-- 場次收支與分潤：純新增六張表，不改任何既有欄位。
-- SessionSignup.amount 僅在 schema 標 @deprecated（註解），DB 不動。
-- 金額 Int = 新台幣元；費率 ppm（2% = 20000）。

CREATE TABLE "SessionOrder" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "buyerName" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "buyerEmail" TEXT,
    "payerName" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "paymentMethodRaw" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 0,
    "orderStatus" TEXT,
    "paymentStatus" TEXT,
    "orderedAt" TIMESTAMP(3),
    "seats" INTEGER NOT NULL DEFAULT 1,
    "isRecognized" BOOLEAN NOT NULL DEFAULT true,
    "excludeReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionOrder_sessionId_orderNo_key" ON "SessionOrder"("sessionId", "orderNo");
CREATE INDEX "SessionOrder_sessionId_idx" ON "SessionOrder"("sessionId");
CREATE INDEX "SessionOrder_orderNo_idx" ON "SessionOrder"("orderNo");

ALTER TABLE "SessionOrder" ADD CONSTRAINT "SessionOrder_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productRaw" TEXT NOT NULL,
    "planLabel" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "recognizedAmount" INTEGER NOT NULL,
    "recognizeNote" TEXT,
    "isOnsite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionOrderLine_orderId_idx" ON "SessionOrderLine"("orderId");

ALTER TABLE "SessionOrderLine" ADD CONSTRAINT "SessionOrderLine_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "SessionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionCost" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "basisText" TEXT,
    "basisAmount" INTEGER,
    "ratePpm" INTEGER,
    "unitAmount" INTEGER,
    "unitCount" INTEGER,
    "amount" INTEGER NOT NULL,
    "isAuto" BOOLEAN NOT NULL DEFAULT true,
    "payee" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionCost_sessionId_idx" ON "SessionCost"("sessionId");

ALTER TABLE "SessionCost" ADD CONSTRAINT "SessionCost_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionProfitShare" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "sharePpm" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionProfitShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionProfitShare_sessionId_payeeName_key" ON "SessionProfitShare"("sessionId", "payeeName");
CREATE INDEX "SessionProfitShare_sessionId_idx" ON "SessionProfitShare"("sessionId");

ALTER TABLE "SessionProfitShare" ADD CONSTRAINT "SessionProfitShare_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionFinance" (
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalIncome" INTEGER NOT NULL DEFAULT 0,
    "totalCost" INTEGER NOT NULL DEFAULT 0,
    "grossProfit" INTEGER NOT NULL DEFAULT 0,
    "sourceFile" TEXT,
    "sourceNote" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionFinance_pkey" PRIMARY KEY ("sessionId")
);

ALTER TABLE "SessionFinance" ADD CONSTRAINT "SessionFinance_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FinancePlanAlias" (
    "productRaw" TEXT NOT NULL,
    "planLabel" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePlanAlias_pkey" PRIMARY KEY ("productRaw")
);
