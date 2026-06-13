-- AlterTable：開通來源（PURCHASE/MANUAL/BATCH/IMPORT；既有資料為 null，顯示時依 orderId 推斷）
ALTER TABLE "Enrollment" ADD COLUMN "source" TEXT;
