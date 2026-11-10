-- AlterTable
ALTER TABLE "SupplierPO" ADD COLUMN     "orderKind" TEXT;

-- CreateTable
CREATE TABLE "SupplierCommitment" (
    "id" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "contact" TEXT,
    "lastConfirmedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3),
    "occurredNote" TEXT,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCommitment_supplierPoId_idx" ON "SupplierCommitment"("supplierPoId");

-- AddForeignKey
ALTER TABLE "SupplierCommitment" ADD CONSTRAINT "SupplierCommitment_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;
