-- Internal purchases from Operaciones (2026-11-19): what the company buys for itself (a product or a service),
-- its spending category for the monthly report, and the receipts attached to the request.
ALTER TABLE "InternalPurchase" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "InternalPurchase" ADD COLUMN "category" TEXT;

CREATE TABLE "InternalPurchaseFile" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalPurchaseFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalPurchaseFile_purchaseId_idx" ON "InternalPurchaseFile"("purchaseId");
CREATE INDEX "InternalPurchase_boughtAt_idx" ON "InternalPurchase"("boughtAt");

ALTER TABLE "InternalPurchaseFile" ADD CONSTRAINT "InternalPurchaseFile_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "InternalPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
