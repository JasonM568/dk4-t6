-- AlterTable：講座索取紀錄加寄送狀態追蹤（全 nullable 零風險；null = 追蹤上線前的舊資料）
-- deliveryStatus：SENT/DELIVERED/OPENED/CLICKED/BOUNCED/COMPLAINED/FAILED（Resend webhook 回流）
ALTER TABLE "WebinarRequest" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "WebinarRequest" ADD COLUMN "deliveryDetail" TEXT;
ALTER TABLE "WebinarRequest" ADD COLUMN "deliveryAt" TIMESTAMP(3);
