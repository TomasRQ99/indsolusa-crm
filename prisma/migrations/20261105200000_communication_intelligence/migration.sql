-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'CALL', 'NOTE');

-- CreateEnum
CREATE TYPE "CommDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "CommThread" (
    "id" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "subject" TEXT,
    "externalKey" TEXT,
    "partyName" TEXT,
    "partyAddr" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "lastInAt" TIMESTAMP(3),
    "lastOutAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "CommDirection" NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommItem" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommThread_externalKey_key" ON "CommThread"("externalKey");

-- CreateIndex
CREATE INDEX "CommThread_lastAt_idx" ON "CommThread"("lastAt");

-- CreateIndex
CREATE INDEX "CommThread_accountId_idx" ON "CommThread"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CommMessage_externalId_key" ON "CommMessage"("externalId");

-- CreateIndex
CREATE INDEX "CommMessage_threadId_sentAt_idx" ON "CommMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "CommItem_threadId_idx" ON "CommItem"("threadId");

-- AddForeignKey
ALTER TABLE "CommThread" ADD CONSTRAINT "CommThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommThread" ADD CONSTRAINT "CommThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommThread" ADD CONSTRAINT "CommThread_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommMessage" ADD CONSTRAINT "CommMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommMessage" ADD CONSTRAINT "CommMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommAttachment" ADD CONSTRAINT "CommAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommItem" ADD CONSTRAINT "CommItem_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommItem" ADD CONSTRAINT "CommItem_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

