-- 註冊嘗試紀錄：每一次註冊的結果都留一筆（成功也記），供後台「註冊狀況」監控板。
--
-- 起因：2026-08-29～09-12 註冊功能整整壞了 14 天（parseProfileFields 讀 "name"，
-- 但註冊頁的欄位叫 "displayName"），期間零註冊卻沒有任何告警，靠學員回報才發現。
-- 失敗只回給使用者一行紅字，伺服器端什麼都沒留下——這張表就是要補上那個訊號。
--
-- 個資最小化：不存密碼；成功的那筆不存 email／姓名／手機（Supabase 帳號表已有）；
-- 失敗的才存聯絡方式（用途正是把卡住的人找回來）；90 天由 cron 自動清除。
--
-- 限於 course schema；不觸碰 public / auth。純新增資料表，不動既有資料。

CREATE TABLE "course"."RegisterAttempt" (
  "id"        TEXT NOT NULL,
  "reason"    TEXT NOT NULL,
  "email"     TEXT,
  "name"      TEXT,
  "phone"     TEXT,
  "detail"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RegisterAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegisterAttempt_createdAt_idx"
  ON "course"."RegisterAttempt"("createdAt");

-- 監控板主要查詢是「某段期間依原因分組」，複合索引直接覆蓋
CREATE INDEX "RegisterAttempt_reason_createdAt_idx"
  ON "course"."RegisterAttempt"("reason", "createdAt");
