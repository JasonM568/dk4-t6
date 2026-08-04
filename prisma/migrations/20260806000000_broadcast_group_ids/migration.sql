-- AlterTable：EDM 發送對象支援「複選名單群組」
-- 軟連結不加 FK（與 groupId / sourceBroadcastId / resendOfId 慣例一致）；
-- 寄出當下取所選群組的成員聯集，再以 email 去重（dedupeByEmail），重疊學員只收一封。
ALTER TABLE "EmailBroadcast" ADD COLUMN     "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 回填：既有單選紀錄（含排程中 SCHEDULED、草稿 DRAFT）轉成單元素陣列。
-- 舊 groupId 欄位保留不動，讀取一律走 broadcastGroupIds()（新欄位優先，空陣列才退回舊欄位）。
UPDATE "EmailBroadcast"
SET "groupIds" = ARRAY["groupId"]
WHERE "groupId" IS NOT NULL
  AND COALESCE(array_length("groupIds", 1), 0) = 0;
