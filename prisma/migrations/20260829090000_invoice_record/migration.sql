-- 電子發票開立紀錄（ezPay）。限於 course schema；不觸碰 public / auth。
CREATE TABLE "course"."InvoiceRecord" (
  "id"             TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "orderNo"        TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "invoiceNumber"  TEXT,
  "randomNum"      TEXT,
  "invoiceTransNo" TEXT,
  "buyerEmail"     TEXT,
  "totalAmt"       INTEGER NOT NULL,
  "issuedAt"       TIMESTAMP(3),
  "error"          TEXT,
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "raw"            JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceRecord_orderId_key" ON "course"."InvoiceRecord"("orderId");
CREATE INDEX "InvoiceRecord_status_idx" ON "course"."InvoiceRecord"("status");
