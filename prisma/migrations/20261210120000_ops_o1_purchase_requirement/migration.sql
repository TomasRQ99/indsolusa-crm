-- CreateTable
CREATE TABLE "PurchaseRequirement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'PRODUCT',
    "economicNature" TEXT NOT NULL DEFAULT 'DIRECT_COST',
    "sellerKey" TEXT NOT NULL DEFAULT 'USA',
    "requesterId" TEXT NOT NULL,
    "dealId" TEXT,
    "supplierId" TEXT,
    "neededBy" TIMESTAMP(3),
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "justification" TEXT,
    "sourceEvidence" TEXT,
    "nextMove" TEXT,
    "stockStatus" TEXT NOT NULL DEFAULT 'NONE',
    "stockQtyApproved" INTEGER,
    "stockAmount" DECIMAL(14,2),
    "stockRequestedAt" TIMESTAMP(3),
    "stockDecidedAt" TIMESTAMP(3),
    "stockDecidedByName" TEXT,
    "stockNote" TEXT,
    "supplierPoId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequirementLine" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "manufacturer" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'un',
    "spec" TEXT,
    "expectedUnitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseRequirementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseAllocation" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "PurchaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequirement_code_key" ON "PurchaseRequirement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequirement_supplierPoId_key" ON "PurchaseRequirement"("supplierPoId");

-- CreateIndex
CREATE INDEX "PurchaseRequirement_dealId_idx" ON "PurchaseRequirement"("dealId");

-- CreateIndex
CREATE INDEX "PurchaseRequirementLine_prId_idx" ON "PurchaseRequirementLine"("prId");

-- CreateIndex
CREATE INDEX "PurchaseAllocation_dealId_idx" ON "PurchaseAllocation"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAllocation_lineId_dealId_key" ON "PurchaseAllocation"("lineId", "dealId");

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirementLine" ADD CONSTRAINT "PurchaseRequirementLine_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseRequirementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
