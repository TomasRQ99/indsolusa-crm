-- Supplier currency on the Need's cost sheet (owner, 2026-11-25). Additive: existing Needs stay in USD.
ALTER TABLE "Deal" ADD COLUMN "costCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Deal" ADD COLUMN "supplierCostNative" DECIMAL(16,2);
ALTER TABLE "Deal" ADD COLUMN "costFxRate" DECIMAL(18,10);
ALTER TABLE "Deal" ADD COLUMN "costFxSource" TEXT;
