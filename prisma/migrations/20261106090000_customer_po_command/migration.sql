-- CreateEnum
CREATE TYPE "ResolutionOption" AS ENUM ('AMEND_DATE', 'EXPEDITE_ABSORB', 'EXPEDITE_CHARGE');

-- CreateEnum
CREATE TYPE "ResolutionState" AS ENUM ('REQUESTED', 'CONFIRMED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "CustomerPO" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "quoteId" TEXT,
    "number" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "requiredBy" TIMESTAMP(3),
    "incoterm" TEXT,
    "paymentTerms" TEXT,
    "shipTo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quoteRef" TEXT,
    "source" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByName" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "CustomerPO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPOLine" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CustomerPOLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoResolution" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "option" "ResolutionOption" NOT NULL,
    "state" "ResolutionState" NOT NULL DEFAULT 'REQUESTED',
    "promiseDate" TIMESTAMP(3) NOT NULL,
    "costDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "priceDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "scenarioLabel" TEXT,
    "message" TEXT,
    "evidence" TEXT,
    "chosenById" TEXT NOT NULL,
    "chosenByName" TEXT NOT NULL,
    "chosenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByName" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PoResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoAcceptance" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptedByName" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promiseDate" TIMESTAMP(3) NOT NULL,
    "resolutionId" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "PoAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerPO_dealId_idx" ON "CustomerPO"("dealId");

-- CreateIndex
CREATE INDEX "PoResolution_poId_idx" ON "PoResolution"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "PoAcceptance_poId_key" ON "PoAcceptance"("poId");

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOLine" ADD CONSTRAINT "CustomerPOLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoResolution" ADD CONSTRAINT "PoResolution_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoAcceptance" ADD CONSTRAINT "PoAcceptance_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

