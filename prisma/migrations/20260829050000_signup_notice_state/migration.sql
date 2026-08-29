-- 課前通知狀態：記「誰已經通知到了」，開課前重複匯入名單時才算得出「還有誰沒收到」
ALTER TABLE "SessionSignup" ADD COLUMN "smsNoticeAt" TIMESTAMP(3);
ALTER TABLE "SessionSignup" ADD COLUMN "emailNoticeAt" TIMESTAMP(3);

-- 簡訊發送對象範圍（ALL/PENDING）與回寫用的名單列 id
ALTER TABLE "SmsBroadcast" ADD COLUMN "noticeScope" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "SmsBroadcast" ADD COLUMN "signupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
