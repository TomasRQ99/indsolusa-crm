-- AlterTable
ALTER TABLE "CustomerPayment" ADD COLUMN     "certificate" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CASH',
ADD COLUMN     "withholdingNote" TEXT,
ADD COLUMN     "withholdingType" TEXT;

