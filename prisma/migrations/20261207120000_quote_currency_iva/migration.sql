-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "docFxRate" DECIMAL(12,2),
ADD COLUMN     "docFxSource" TEXT,
ADD COLUMN     "ivaExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ivaExemptReason" TEXT,
ADD COLUMN     "ivaPct" DECIMAL(5,2),
ADD COLUMN     "sellerSnap" JSONB;
