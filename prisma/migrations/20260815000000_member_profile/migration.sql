-- CreateTable：會員補充資料（手機＋個資同意紀錄）。全新表，零風險 additive。
-- QBC 共用的 profiles 表（另一 schema）唯讀不可動，本平台的手機欄位與個資法同意紀錄存自己的 course schema。
CREATE TABLE "MemberProfile" (
    "userId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "privacyConsentAt" TIMESTAMP(3) NOT NULL,
    "privacyConsentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "MemberProfile_phone_idx" ON "MemberProfile"("phone");
