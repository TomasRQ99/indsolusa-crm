-- Cost settlement on the quote: the parts of "other costs" typed one by one, a credit in our favor and transit days.
-- Additive. Existing quotes keep their otherCosts total; what has no detail shows as "Otros".
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "taxCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customsCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "packingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wireCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditSrc" TEXT,
ADD COLUMN     "transitDays" INTEGER;
