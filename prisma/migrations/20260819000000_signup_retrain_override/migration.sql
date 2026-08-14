-- 場次名單：新舊生人工覆寫欄位
-- null（預設）= 沿用原本「產品名含『複訓』」的自動判別，既有資料行為完全不變。
-- 只新增一個可為 NULL 的欄位，不改動任何既有欄位。

ALTER TABLE "SessionSignup" ADD COLUMN "isRetrain" BOOLEAN;
