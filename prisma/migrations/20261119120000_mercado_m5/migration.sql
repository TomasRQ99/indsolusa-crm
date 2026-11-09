-- CreateTable
CREATE TABLE "PersonNote" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "evidence" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenLoop" (
    "id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "accountId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "explorationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "closedByName" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparedMessage" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "audienceRole" TEXT,
    "channel" TEXT NOT NULL,
    "contactId" TEXT,
    "accountId" TEXT,
    "draft" TEXT NOT NULL,
    "finalText" TEXT,
    "sourceContextIds" TEXT[],
    "factsUsed" JSONB NOT NULL,
    "inferencesUsed" JSONB NOT NULL,
    "tonePolicy" TEXT NOT NULL DEFAULT 'carnegie',
    "policyVersion" TEXT NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "checks" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonNote_contactId_idx" ON "PersonNote"("contactId");

-- CreateIndex
CREATE INDEX "OpenLoop_accountId_status_idx" ON "OpenLoop"("accountId", "status");

-- CreateIndex
CREATE INDEX "OpenLoop_contactId_status_idx" ON "OpenLoop"("contactId", "status");

-- CreateIndex
CREATE INDEX "PreparedMessage_contactId_idx" ON "PreparedMessage"("contactId");

-- CreateIndex
CREATE INDEX "PreparedMessage_accountId_idx" ON "PreparedMessage"("accountId");

-- AddForeignKey
ALTER TABLE "PersonNote" ADD CONSTRAINT "PersonNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedMessage" ADD CONSTRAINT "PreparedMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedMessage" ADD CONSTRAINT "PreparedMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
