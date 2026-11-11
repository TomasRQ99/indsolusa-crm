-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "commissionSettlementRunId" TEXT;

-- CreateTable
CREATE TABLE "CommissionSettlementRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "lines" JSONB NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidByName" TEXT,
    "payrollRef" TEXT,

    CONSTRAINT "CommissionSettlementRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSettlementRun_period_version_key" ON "CommissionSettlementRun"("period", "version");

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_commissionSettlementRunId_fkey" FOREIGN KEY ("commissionSettlementRunId") REFERENCES "CommissionSettlementRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

