-- AlterTable
ALTER TABLE "CustomerPO" ADD COLUMN     "billTo" TEXT,
ADD COLUMN     "conditionsAck" JSONB,
ADD COLUMN     "documents" TEXT,
ADD COLUMN     "ivaMode" TEXT,
ADD COLUMN     "legalEntity" TEXT,
ADD COLUMN     "otherConditions" TEXT,
ADD COLUMN     "penalties" TEXT,
ADD COLUMN     "supplyRevalidatedAt" TIMESTAMP(3),
ADD COLUMN     "supplyRevalidatedBy" TEXT,
ADD COLUMN     "supplyRevalidation" TEXT,
ADD COLUMN     "taxIdOnPo" TEXT,
ADD COLUMN     "warranty" TEXT;

-- CreateTable
CREATE TABLE "PoAllocation" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "lineRef" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchInstruction" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "poId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL,
    "destination" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "promiseDate" TIMESTAMP(3),
    "documents" TEXT,
    "entryRequirement" TEXT,
    "restrictions" TEXT,
    "changeReason" TEXT,
    "issuedByName" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "DispatchInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoAllocation_dealId_idx" ON "PoAllocation"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "PoAllocation_poId_dealId_key" ON "PoAllocation"("poId", "dealId");

-- CreateIndex
CREATE INDEX "DispatchInstruction_dealId_idx" ON "DispatchInstruction"("dealId");

-- AddForeignKey
ALTER TABLE "PoAllocation" ADD CONSTRAINT "PoAllocation_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoAllocation" ADD CONSTRAINT "PoAllocation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchInstruction" ADD CONSTRAINT "DispatchInstruction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchInstruction" ADD CONSTRAINT "DispatchInstruction_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;

