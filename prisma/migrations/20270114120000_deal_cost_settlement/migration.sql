-- Cost settlement on the Need (Necesidad): the same lines as the quote's sheet. Additive.
-- Existing Needs keep their otherCosts total; what has no detail shows as "Otros".
-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "taxCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customsCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "packingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "wireCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditSrc" TEXT,
ADD COLUMN     "transitDays" INTEGER;
