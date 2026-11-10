-- AlterTable
ALTER TABLE "CustomerPO" ADD COLUMN     "docFxRate" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "CustomerPOLine" ADD COLUMN     "docUnitPrice" DECIMAL(16,2);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "docCurrency" TEXT,
ADD COLUMN     "docTotal" DECIMAL(16,2),
ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false;
