-- AlterTable
ALTER TABLE "CommercialMission" ADD COLUMN     "budgetApproved" DECIMAL(14,2),
ADD COLUMN     "budgetDecidedAt" TIMESTAMP(3),
ADD COLUMN     "budgetDecidedByName" TEXT,
ADD COLUMN     "budgetNote" TEXT,
ADD COLUMN     "budgetRequestedAt" TIMESTAMP(3),
ADD COLUMN     "expensesStatus" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "expensesSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "reconcileNote" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledByName" TEXT;

-- CreateTable
CREATE TABLE "MissionExpense" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "originalNote" TEXT,
    "receiptName" TEXT,
    "receiptMime" TEXT,
    "receiptSize" INTEGER,
    "receiptData" BYTEA,
    "noReceiptReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionExpense_missionId_idx" ON "MissionExpense"("missionId");

-- AddForeignKey
ALTER TABLE "MissionExpense" ADD CONSTRAINT "MissionExpense_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "CommercialMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Budget requests recorded before this wave waited for Module 14: they are now ordinary requests.
UPDATE "CommercialMission" SET "budgetStatus" = 'REQUESTED', "budgetRequestedAt" = "createdAt" WHERE "budgetStatus" = 'WAITING_MODULE_14';