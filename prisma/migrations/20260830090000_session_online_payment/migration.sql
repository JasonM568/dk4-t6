-- 場次線上金流報名（Phase 2）：報名方式 2 選 1（導外部 / 平台金流）+ 場次訂單表。
-- 限於 course schema；不觸碰 public / auth。全 additive，無 DROP。

-- 1) CourseSession：報名方式模式 + 平台金流每人單價
ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupPayMode" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "signupPrice" INTEGER;

-- 舊資料回填：原本填了外部網址的場次 = 導外部模式；其餘維持手動表單，行為完全不變
UPDATE "course"."CourseSession"
  SET "signupPayMode" = 'EXTERNAL'
  WHERE "signupUrl" IS NOT NULL AND "signupUrl" <> '';

-- 2) 場次線上金流訂單（軟連結，不設跨表 FK）
CREATE TABLE "course"."SessionSignupOrder" (
  "id"          TEXT NOT NULL,
  "orderNo"     TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "buyerEmail"  TEXT NOT NULL,
  "buyerName"   TEXT NOT NULL,
  "buyerPhone"  TEXT NOT NULL,
  "attendees"   JSONB NOT NULL,
  "quantity"    INTEGER NOT NULL,
  "unitPrice"   INTEGER NOT NULL,
  "total"       INTEGER NOT NULL,
  "status"      "course"."OrderStatus" NOT NULL DEFAULT 'PENDING',
  "checkoutKey" TEXT,
  "provider"    TEXT NOT NULL,
  "tradeNo"     TEXT,
  "paymentType" TEXT,
  "rawCallback" JSONB,
  "paidAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SessionSignupOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionSignupOrder_orderNo_key" ON "course"."SessionSignupOrder"("orderNo");
CREATE UNIQUE INDEX "SessionSignupOrder_checkoutKey_key" ON "course"."SessionSignupOrder"("checkoutKey");
CREATE INDEX "SessionSignupOrder_sessionId_status_idx" ON "course"."SessionSignupOrder"("sessionId", "status");
