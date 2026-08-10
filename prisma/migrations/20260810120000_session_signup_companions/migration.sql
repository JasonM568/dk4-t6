-- 一張 1shop 訂單可包含訂購人與多位同行者；每位同行者各自成為場次名單的一筆。
ALTER TABLE "SessionSignup" ADD COLUMN "attendeeKey" TEXT NOT NULL DEFAULT 'buyer';

DROP INDEX "SessionSignup_sessionId_orderNo_key";

CREATE UNIQUE INDEX "SessionSignup_sessionId_orderNo_attendeeKey_key"
  ON "SessionSignup"("sessionId", "orderNo", "attendeeKey");
