-- 蜜罐擋下的講座索取：不再靜默吞掉。
--
-- 原本 requestWebinarLinkAction 觸發蜜罐時只寫一行 console.error 就回「已寄出」，
-- Vercel 的 runtime log 保存期短到事後查不回來，被誤殺的真人因此完全無跡可尋
-- （2026-09-03 fly.eagle、2026-09-08 emilychi07 兩起都是這樣，只能用刪去法推定）。
--
-- 刻意獨立成一張表而不是寫進 WebinarRequest：那張表是「名單」，
-- 會被 /board、索取人數、EDM／簡訊的 audienceType=WEBINAR 一起吃進去。
-- 把疑似機器人混進名單，等於拿正式名單去冒風險換診斷能力，不划算。
--
-- 限於 course schema；不觸碰 public / auth。純新增資料表，不動既有資料。

CREATE TABLE "course"."WebinarBlockedAttempt" (
  "id"        TEXT NOT NULL,
  "webinarId" TEXT NOT NULL,
  "email"     TEXT,
  "name"      TEXT,
  "phone"     TEXT,
  "reason"    TEXT NOT NULL DEFAULT 'HONEYPOT',
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebinarBlockedAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebinarBlockedAttempt_webinarId_idx"
  ON "course"."WebinarBlockedAttempt"("webinarId");

-- 講座刪除時一併清掉（同 WebinarRequest 的 onDelete: Cascade）
ALTER TABLE "course"."WebinarBlockedAttempt"
  ADD CONSTRAINT "WebinarBlockedAttempt_webinarId_fkey"
  FOREIGN KEY ("webinarId") REFERENCES "course"."Webinar"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
