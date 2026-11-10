-- AlterTable
ALTER TABLE "Rfq" ADD COLUMN     "asked" JSONB;

-- CreateTable
CREATE TABLE "SourcingSearch" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidates" JSONB NOT NULL,
    "discarded" JSONB NOT NULL,
    "note" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOption" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offerId" TEXT,
    "rfqId" TEXT,
    "label" TEXT NOT NULL,
    "covers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includedNote" TEXT,
    "excludedNote" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "price" DECIMAL(14,2),
    "qty" INTEGER,
    "stockQty" INTEGER,
    "leadDaysMin" INTEGER,
    "leadDaysMax" INTEGER,
    "leadTrigger" TEXT,
    "validUntil" TIMESTAMP(3),
    "condition" TEXT,
    "warranty" TEXT,
    "incoterm" TEXT,
    "pickup" TEXT,
    "origin" TEXT,
    "hsSupplier" TEXT,
    "grossKg" DECIMAL(10,3),
    "dims" TEXT,
    "packages" INTEGER,
    "availability" TEXT NOT NULL DEFAULT 'QUOTE',
    "importFeasibility" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "importNote" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "discardReason" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentOption" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "surchargePct" DECIMAL(6,3),
    "fixedFee" DECIMAL(12,2),
    "fxSpreadPct" DECIMAL(6,3),
    "daysToRelease" INTEGER,
    "releaseTrigger" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyBasis" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "primaryId" TEXT NOT NULL,
    "backupId" TEXT,
    "paymentOptionId" TEXT,
    "reason" TEXT NOT NULL,
    "risks" TEXT,
    "selectedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "SupplyBasis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsObservation" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "supplierId" TEXT,
    "dealId" TEXT,
    "qtyContext" INTEGER,
    "packaging" TEXT,
    "netKg" DECIMAL(10,3),
    "grossKg" DECIMAL(10,3),
    "lengthCm" DECIMAL(8,1),
    "widthCm" DECIMAL(8,1),
    "heightCm" DECIMAL(8,1),
    "packages" INTEGER,
    "origin" TEXT,
    "hsSupplier" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogisticsObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportExperience" (
    "id" TEXT NOT NULL,
    "partId" TEXT,
    "dealId" TEXT,
    "productLabel" TEXT NOT NULL,
    "hsCode" TEXT,
    "hsCriterion" TEXT,
    "documents" TEXT,
    "approvals" TEXT,
    "agentNotes" TEXT,
    "inspection" TEXT,
    "realCostUsd" DECIMAL(14,2),
    "days" INTEGER,
    "delays" TEXT,
    "resolution" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportExperience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcingSearch_dealId_idx" ON "SourcingSearch"("dealId");

-- CreateIndex
CREATE INDEX "SupplyOption_dealId_idx" ON "SupplyOption"("dealId");

-- CreateIndex
CREATE INDEX "SupplyOption_supplierId_idx" ON "SupplyOption"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPaymentOption_optionId_idx" ON "SupplierPaymentOption"("optionId");

-- CreateIndex
CREATE INDEX "SupplyBasis_dealId_idx" ON "SupplyBasis"("dealId");

-- CreateIndex
CREATE INDEX "LogisticsObservation_partId_idx" ON "LogisticsObservation"("partId");

-- CreateIndex
CREATE INDEX "ImportExperience_partId_idx" ON "ImportExperience"("partId");

-- AddForeignKey
ALTER TABLE "SourcingSearch" ADD CONSTRAINT "SourcingSearch_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOption" ADD CONSTRAINT "SupplyOption_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOption" ADD CONSTRAINT "SupplyOption_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOption" ADD CONSTRAINT "SupplyOption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SupplierOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentOption" ADD CONSTRAINT "SupplierPaymentOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SupplyOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBasis" ADD CONSTRAINT "SupplyBasis_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBasis" ADD CONSTRAINT "SupplyBasis_primaryId_fkey" FOREIGN KEY ("primaryId") REFERENCES "SupplyOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBasis" ADD CONSTRAINT "SupplyBasis_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "SupplyOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyBasis" ADD CONSTRAINT "SupplyBasis_paymentOptionId_fkey" FOREIGN KEY ("paymentOptionId") REFERENCES "SupplierPaymentOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsObservation" ADD CONSTRAINT "LogisticsObservation_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsObservation" ADD CONSTRAINT "LogisticsObservation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportExperience" ADD CONSTRAINT "ImportExperience_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
