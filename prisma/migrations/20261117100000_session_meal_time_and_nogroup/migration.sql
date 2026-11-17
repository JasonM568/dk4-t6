-- 場次看板兩項優化：
-- 1) CourseSession.needsDinner：加開晚餐調查。午餐一律統計（維持現狀）；兩天一夜等
--    場次晚上也要訂餐時，開這個開關，每人會多一欄晚餐葷素，兩種餐點數字分開統計顯示。
-- 2) SessionSignup.noGroup：手動標記「不參加分組」的人——仍計入新舊生／用餐統計，
--    但自動分組／補分組一律跳過，組別鎖在未分組（主持人、提前離場等不需要併桌的人）。
--    SessionSignup.mealDinner：晚餐葷素，格式同既有的 meal；只有開了 needsDinner 的
--    場次才會用到。
--
-- 限於 course schema；不觸碰 public / auth。純新增欄位（皆有預設值），不動既有資料。

ALTER TABLE "course"."CourseSession"
  ADD COLUMN "needsDinner" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "course"."SessionSignup"
  ADD COLUMN "noGroup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mealDinner" TEXT;
