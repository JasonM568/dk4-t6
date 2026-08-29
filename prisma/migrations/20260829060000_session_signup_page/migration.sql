-- 場次公開報名頁 Phase 1（不含金流）
-- ① CourseSession 擴充報名頁欄位　② 新增 SessionSignupRequest 待確認報名表
-- 全部限於 course schema；不觸碰 public / auth。

-- ① 報名頁設定
ALTER TABLE "course"."CourseSession"
  ADD COLUMN "signupSlug"      TEXT,
  ADD COLUMN "isSignupOpen"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dmImage"         TEXT,
  ADD COLUMN "dmImages"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "signupIntro"     TEXT,
  ADD COLUMN "venue"           TEXT,
  ADD COLUMN "address"         TEXT,
  ADD COLUMN "signupOpenAt"    TIMESTAMP(3),
  ADD COLUMN "signupCloseAt"   TIMESTAMP(3),
  ADD COLUMN "signupQuota"     INTEGER,
  ADD COLUMN "signupPriceNote" TEXT,
  ADD COLUMN "signupPayNote"   TEXT,
  ADD COLUMN "signupNotice"    TEXT,
  ADD COLUMN "signupGroupId"   TEXT;

CREATE UNIQUE INDEX "CourseSession_signupSlug_key"
  ON "course"."CourseSession"("signupSlug");

-- ② 待確認報名（訪客送出 → 管理員確認收款 → 轉入 SessionSignup）
CREATE TABLE "course"."SessionSignupRequest" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "orderNo"     TEXT NOT NULL,
  "attendeeKey" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "email"       TEXT,
  "phone"       TEXT,
  "meal"        TEXT NOT NULL DEFAULT 'MEAT',
  "isRetrain"   BOOLEAN NOT NULL DEFAULT false,
  "buyerName"   TEXT NOT NULL,
  "buyerEmail"  TEXT,
  "buyerPhone"  TEXT,
  "note"        TEXT,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "confirmedAt" TIMESTAMP(3),
  "signupId"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SessionSignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionSignupRequest_sessionId_orderNo_attendeeKey_key"
  ON "course"."SessionSignupRequest"("sessionId", "orderNo", "attendeeKey");

CREATE INDEX "SessionSignupRequest_sessionId_status_idx"
  ON "course"."SessionSignupRequest"("sessionId", "status");

ALTER TABLE "course"."SessionSignupRequest"
  ADD CONSTRAINT "SessionSignupRequest_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "course"."CourseSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
