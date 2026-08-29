-- 課程詳情區塊：圖片與影片混排、可調順序，取代原本只能放圖的 dmImages。
-- 既有 dmImages 的內容依序轉成 {type:"image"} 區塊，不遺失資料。
-- 限於 course schema；不觸碰 public / auth。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "dmBlocks" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 舊資料搬家：dmImages 陣列 → [{"type":"image","url":…}] 並保持原順序
UPDATE "course"."CourseSession"
SET "dmBlocks" = (
  SELECT coalesce(
    jsonb_agg(jsonb_build_object('type', 'image', 'url', img) ORDER BY ord),
    '[]'::jsonb
  )
  FROM unnest("dmImages") WITH ORDINALITY AS t(img, ord)
)
WHERE array_length("dmImages", 1) > 0;

ALTER TABLE "course"."CourseSession" DROP COLUMN "dmImages";
