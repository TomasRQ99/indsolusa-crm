-- Market exchange rates (Yahoo Finance) and more decimals for the quote's supplier-currency rate.
-- AlterTable
ALTER TABLE "Quote" ALTER COLUMN "fxRate" SET DATA TYPE DECIMAL(18,10);

-- CreateTable
CREATE TABLE "FxRate" (
    "currency" TEXT NOT NULL,
    "usdPerUnit" DECIMAL(18,10) NOT NULL,
    "unitsPerUsd" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("currency")
);
