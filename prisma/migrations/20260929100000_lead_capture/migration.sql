-- 名單收集模組：把既有的「講座報名」泛化成通用的名單收集頁。
--
-- 既有 5 個講座頁與 413 筆索取紀錄必須零影響，所以 kind 預設 'WEBINAR'，
-- 其餘全部是可空的新欄位／新表，不動任何既有資料。
--
-- 三張新東西：
--   WebinarAsset    素材清單（影片／講義／檔案），取代單一的 lectureUrl。
--                   改素材不必再編信件內文。lectureUrl 保留，{link} 相容既有頁面。
--   WebinarQuestion 問卷題目（單選／多選／簡答），上限 10 題由 action 擋。
--                   刪題一律軟刪（isActive=false）：硬刪會讓已收到的答案失去題目脈絡。
--   WebinarRequest.answers  答案快照（JSON 陣列，每筆含題目文字當下的樣子）。
--                   存快照而不是只存 questionId，是因為題目可以被改被刪，
--                   但半年前收到的答案仍然要看得懂是在回答什麼。
--
-- 限於 course schema；不觸碰 public / auth。

ALTER TABLE "course"."Webinar"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WEBINAR';

ALTER TABLE "course"."WebinarRequest"
  ADD COLUMN "answers" JSONB;

CREATE TABLE "course"."WebinarAsset" (
  "id"        TEXT NOT NULL,
  "webinarId" TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "note"      TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebinarAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebinarAsset_webinarId_fkey" FOREIGN KEY ("webinarId")
    REFERENCES "course"."Webinar"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebinarAsset_webinarId_sortOrder_idx"
  ON "course"."WebinarAsset"("webinarId", "sortOrder");

CREATE TABLE "course"."WebinarQuestion" (
  "id"        TEXT NOT NULL,
  "webinarId" TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  -- SINGLE 單選 / MULTI 複選 / TEXT 簡答
  "type"      TEXT NOT NULL DEFAULT 'SINGLE',
  "options"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "required"  BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  -- 軟刪：已收到的答案要保留題目脈絡，不可硬刪
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebinarQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebinarQuestion_webinarId_fkey" FOREIGN KEY ("webinarId")
    REFERENCES "course"."Webinar"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebinarQuestion_webinarId_sortOrder_idx"
  ON "course"."WebinarQuestion"("webinarId", "sortOrder");
