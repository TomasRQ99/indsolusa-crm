-- AlterTable
ALTER TABLE "RfqRecipient" ADD COLUMN     "repliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutboundMail" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "refKind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refCode" TEXT,
    "partyKind" TEXT NOT NULL,
    "supplierId" TEXT,
    "accountId" TEXT,
    "dealId" TEXT,
    "toAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT,
    "repliedAt" TIMESTAMP(3),
    "replyFrom" TEXT,
    "replySubject" TEXT,
    "replyPreview" TEXT,
    "autoReplyAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMail_conversationId_idx" ON "OutboundMail"("conversationId");

-- CreateIndex
CREATE INDEX "OutboundMail_supplierId_idx" ON "OutboundMail"("supplierId");

-- CreateIndex
CREATE INDEX "OutboundMail_template_idx" ON "OutboundMail"("template");

-- CreateIndex
CREATE INDEX "OutboundMail_refKind_refId_idx" ON "OutboundMail"("refKind", "refId");

-- CreateIndex
CREATE INDEX "OutboundMail_sentAt_idx" ON "OutboundMail"("sentAt");

-- AddForeignKey
ALTER TABLE "OutboundMail" ADD CONSTRAINT "OutboundMail_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMail" ADD CONSTRAINT "OutboundMail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
