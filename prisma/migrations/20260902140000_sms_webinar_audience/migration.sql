-- 簡訊模組新增「講座索取者」名單來源（audienceType=WEBINAR），比照既有的 SESSION。
--   WebinarRequest.smsNoticeAt：對照 SessionSignup.smsNoticeAt，供「只發還沒收到的人」比對。
--   SmsBroadcast.webinarIds：這筆發送要寄給哪幾場講座（發送當下才解析名單）。
-- 限於 course schema；不觸碰 public / auth。純新增欄位，不改動既有資料。

ALTER TABLE "course"."WebinarRequest"
  ADD COLUMN "smsNoticeAt" TIMESTAMP(3);

ALTER TABLE "course"."SmsBroadcast"
  ADD COLUMN "webinarIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
