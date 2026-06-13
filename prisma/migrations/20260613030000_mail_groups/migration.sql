-- AlterTable：群發紀錄加發送對象與名單快照
ALTER TABLE "EmailBroadcast" ADD COLUMN     "audienceType" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "EmailBroadcast" ADD COLUMN     "groupId" TEXT;
ALTER TABLE "EmailBroadcast" ADD COLUMN     "audienceLabel" TEXT;
ALTER TABLE "EmailBroadcast" ADD COLUMN     "manualRows" JSONB;
ALTER TABLE "EmailBroadcast" ADD COLUMN     "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable：電子報名單群組
CREATE TABLE "MailGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MailGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailGroup_name_key" ON "MailGroup"("name");
CREATE UNIQUE INDEX "MailGroupMember_groupId_email_key" ON "MailGroupMember"("groupId", "email");
CREATE INDEX "MailGroupMember_groupId_idx" ON "MailGroupMember"("groupId");

-- AddForeignKey
ALTER TABLE "MailGroupMember" ADD CONSTRAINT "MailGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MailGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
