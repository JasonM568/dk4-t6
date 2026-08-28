-- 收入明細加「新生/複訓」分類（收支表收入區塊的分組鍵）。
-- NULL = 依產品名含「複訓」自動判斷（既有資料行為不變）；有值 = 人工覆寫。
ALTER TABLE "SessionOrderLine" ADD COLUMN "studentType" TEXT;
