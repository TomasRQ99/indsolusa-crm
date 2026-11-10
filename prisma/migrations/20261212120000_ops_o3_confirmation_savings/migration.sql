-- AlterTable
ALTER TABLE "SupplierPO" ADD COLUMN     "ackAt" TIMESTAMP(3),
ADD COLUMN     "ackNote" TEXT,
ADD COLUMN     "firstQuoteAmount" DECIMAL(14,2),
ADD COLUMN     "firstQuoteRef" TEXT,
ADD COLUMN     "negotiationNote" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentByName" TEXT,
ADD COLUMN     "sentHow" TEXT;

-- CreateTable
CREATE TABLE "SupplierConfirmation" (
    "id" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "poVersion" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "currency" TEXT,
    "readyDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "incoterm" TEXT,
    "packaging" TEXT,
    "documents" TEXT,
    "warranty" TEXT,
    "newConditions" TEXT,
    "scope" JSONB NOT NULL DEFAULT '[]',
    "diffs" JSONB NOT NULL DEFAULT '[]',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsEntry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dealId" TEXT,
    "supplierPoId" TEXT,
    "supplierId" TEXT,
    "baselineAmount" DECIMAL(14,2) NOT NULL,
    "baselineSource" TEXT NOT NULL,
    "finalAmount" DECIMAL(14,2) NOT NULL,
    "savingsAmount" DECIMAL(14,2) NOT NULL,
    "passedToCustomer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "evidence" TEXT NOT NULL,
    "note" TEXT,
    "responsibleId" TEXT NOT NULL,
    "responsibleName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavingsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierConfirmation_supplierPoId_idx" ON "SupplierConfirmation"("supplierPoId");

-- CreateIndex
CREATE INDEX "SavingsEntry_dealId_idx" ON "SavingsEntry"("dealId");

-- CreateIndex
CREATE INDEX "SavingsEntry_supplierId_idx" ON "SavingsEntry"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierConfirmation" ADD CONSTRAINT "SupplierConfirmation_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsEntry" ADD CONSTRAINT "SavingsEntry_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Orders that already exist take their current total as the first-quote baseline.
UPDATE "SupplierPO" SET "firstQuoteAmount" = "amount" WHERE "firstQuoteAmount" IS NULL;