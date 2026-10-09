ALTER TABLE "course"."EmailBroadcast" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "EmailBroadcast_requestKey_key" ON "course"."EmailBroadcast"("requestKey");
ALTER TABLE "course"."SmsBroadcast" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "SmsBroadcast_requestKey_key" ON "course"."SmsBroadcast"("requestKey");
ALTER TABLE "course"."EmailBroadcast" ADD COLUMN "resendLockedAt" TIMESTAMP(3);
