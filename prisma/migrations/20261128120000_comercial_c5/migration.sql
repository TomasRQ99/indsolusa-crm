-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "freightStatus" TEXT,
ADD COLUMN     "otherStatus" TEXT,
ADD COLUMN     "supplierStatus" TEXT;

-- CreateTable
CREATE TABLE "ValueAttribute" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEs" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "definitionEs" TEXT NOT NULL,
    "definitionEn" TEXT NOT NULL,
    "appliesWhen" TEXT,
    "restrictions" TEXT,
    "evidenceHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolutionCase" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "understood" TEXT,
    "routes" JSONB,
    "operationalImpact" TEXT,
    "risks" TEXT,
    "recommendation" TEXT,
    "decisionNeeded" TEXT,
    "helpToBuy" TEXT,
    "committee" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolutionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValueClaim" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "need" TEXT NOT NULL,
    "impact" TEXT,
    "advantage" TEXT NOT NULL,
    "benefit" TEXT NOT NULL,
    "evidence" TEXT,
    "evidenceAt" TIMESTAMP(3),
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "validUntil" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresentationRecord" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "quoteId" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" TEXT,
    "changed" TEXT,
    "valued" TEXT,
    "objections" TEXT,
    "whoDecides" TEXT,
    "window" TEXT,
    "nextMove" TEXT,
    "nextMoveDate" TIMESTAMP(3),
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresentationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValueAttribute_key_key" ON "ValueAttribute"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SolutionCase_dealId_key" ON "SolutionCase"("dealId");

-- CreateIndex
CREATE INDEX "ValueClaim_caseId_idx" ON "ValueClaim"("caseId");

-- CreateIndex
CREATE INDEX "PresentationRecord_caseId_idx" ON "PresentationRecord"("caseId");

-- AddForeignKey
ALTER TABLE "SolutionCase" ADD CONSTRAINT "SolutionCase_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueClaim" ADD CONSTRAINT "ValueClaim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SolutionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueClaim" ADD CONSTRAINT "ValueClaim_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "ValueAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationRecord" ADD CONSTRAINT "PresentationRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SolutionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationRecord" ADD CONSTRAINT "PresentationRecord_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

