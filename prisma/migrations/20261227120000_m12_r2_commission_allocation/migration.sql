-- DropIndex
DROP INDEX "CommissionEntry_invoiceId_half_key";

-- CreateTable
CREATE TABLE "CommissionAllocation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pool" TEXT NOT NULL,
    "splitPct" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CommissionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionAllocation_dealId_idx" ON "CommissionAllocation"("dealId");

-- CreateIndex
CREATE INDEX "CommissionAllocation_userId_idx" ON "CommissionAllocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_invoiceId_half_userId_key" ON "CommissionEntry"("invoiceId", "half", "userId");

-- AddForeignKey
ALTER TABLE "CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAllocation" ADD CONSTRAINT "CommissionAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

