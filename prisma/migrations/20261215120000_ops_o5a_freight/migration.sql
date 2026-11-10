-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "customsExpectedRelease" TIMESTAMP(3),
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "plannedDeparture" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FreightRequirement" (
    "id" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "origin" TEXT,
    "pickupAddress" TEXT,
    "pickupContact" TEXT,
    "pickupHours" TEXT,
    "destination" TEXT,
    "readyDate" TIMESTAMP(3),
    "packages" INTEGER,
    "netKg" DECIMAL(10,2),
    "grossKg" DECIMAL(10,2),
    "dims" TEXT,
    "packagingType" TEXT,
    "stackable" BOOLEAN,
    "fragile" BOOLEAN,
    "hazardous" BOOLEAN,
    "temperature" TEXT,
    "incoterm" TEXT,
    "hasInvoice" BOOLEAN NOT NULL DEFAULT false,
    "hasPackingList" BOOLEAN NOT NULL DEFAULT false,
    "exportNote" TEXT,
    "handling" TEXT,
    "insurance" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "weightSource" TEXT NOT NULL DEFAULT 'SUPPLIER_STATED',
    "reconfirmedAt" TIMESTAMP(3),
    "reconfirmNote" TEXT,
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightQuote" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'MANUAL',
    "carrier" TEXT NOT NULL,
    "service" TEXT,
    "mode" TEXT,
    "cost" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "transitDays" INTEGER,
    "pickupDate" TIMESTAMP(3),
    "cutoff" TEXT,
    "insurance" TEXT,
    "customsNote" TEXT,
    "reliability" TEXT,
    "validUntil" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "chosenReason" TEXT,
    "chosenByName" TEXT,
    "chosenAt" TIMESTAMP(3),
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreightQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreightRequirement_supplierPoId_key" ON "FreightRequirement"("supplierPoId");

-- CreateIndex
CREATE INDEX "FreightQuote_requirementId_idx" ON "FreightQuote"("requirementId");

-- AddForeignKey
ALTER TABLE "FreightRequirement" ADD CONSTRAINT "FreightRequirement_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightQuote" ADD CONSTRAINT "FreightQuote_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "FreightRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
