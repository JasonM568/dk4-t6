-- 訪客購課：Order.userId 放寬為可空（下單當下還沒有帳號，付款成功才建立／連結）。
-- 限於 course schema；不觸碰 public / auth。只放寬欄位約束，不刪任何資料。

ALTER TABLE "course"."Order"
  ALTER COLUMN "userId" DROP NOT NULL;
