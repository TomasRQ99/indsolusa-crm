-- CreateEnum
CREATE TYPE "ResultState" AS ENUM ('PENDING', 'PARTIAL', 'ACHIEVED', 'NOT_ACHIEVED', 'NO_LONGER_RELEVANT');

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "actualResult" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedByName" TEXT,
ADD COLUMN     "closureLearning" TEXT,
ADD COLUMN     "closureNoSignalReason" TEXT,
ADD COLUMN     "closureSummary" TEXT,
ADD COLUMN     "reliefNote" TEXT,
ADD COLUMN     "resultConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "resultConfirmedByName" TEXT,
ADD COLUMN     "resultPendingNote" TEXT,
ADD COLUMN     "resultState" "ResultState" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "ResultEvidence" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "who" TEXT,
    "source" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recovery" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByName" TEXT NOT NULL,
    "whatChanged" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "selectedKey" TEXT,
    "selectedAt" TIMESTAMP(3),
    "selectedByName" TEXT,
    "selectedNote" TEXT,
    "expectedBy" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeNote" TEXT,

    CONSTRAINT "Recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuitySignal" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "triggerOn" TIMESTAMP(3),
    "triggerEvent" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ContinuitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResultEvidence_dealId_idx" ON "ResultEvidence"("dealId");

-- CreateIndex
CREATE INDEX "Recovery_dealId_idx" ON "Recovery"("dealId");

-- CreateIndex
CREATE INDEX "ContinuitySignal_dealId_idx" ON "ContinuitySignal"("dealId");

-- AddForeignKey
ALTER TABLE "ResultEvidence" ADD CONSTRAINT "ResultEvidence_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuitySignal" ADD CONSTRAINT "ContinuitySignal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Results already confirmed become ACHIEVED, with the old note as the actual result.
UPDATE "Deal" SET "resultState" = 'ACHIEVED', "actualResult" = COALESCE("actualResult", "resultNote"), "resultConfirmedAt" = "resultAchievedAt" WHERE "resultAchievedAt" IS NOT NULL;
