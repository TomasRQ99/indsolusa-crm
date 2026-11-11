-- DropIndex
DROP INDEX "CommissionEntry_invoiceId_half_userId_key";

-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_invoiceId_half_userId_seq_key" ON "CommissionEntry"("invoiceId", "half", "userId", "seq");

