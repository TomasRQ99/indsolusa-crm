-- AlterTable
ALTER TABLE "PaymentExecution" ADD COLUMN     "feeUsd" DECIMAL(14,2),
ADD COLUMN     "fxRate" DECIMAL(14,6),
ADD COLUMN     "method" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "orderReleasedAt" TIMESTAMP(3),
ADD COLUMN     "orderReleasedNote" TEXT,
ADD COLUMN     "supplierReceivedAt" TIMESTAMP(3),
ADD COLUMN     "supplierReceivedNote" TEXT;
