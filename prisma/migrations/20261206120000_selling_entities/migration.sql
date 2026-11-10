-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "sellerKey" TEXT NOT NULL DEFAULT 'USA';

-- CreateTable
CREATE TABLE "SellingEntity" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxIdLabel" TEXT,
    "taxId" TEXT,
    "addressLines" TEXT,
    "phone" TEXT,
    "country" TEXT NOT NULL,
    "ivaPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "allowsCop" BOOLEAN NOT NULL DEFAULT false,
    "invoiceMode" TEXT NOT NULL DEFAULT 'SOLU',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellingEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellingEntity_key_key" ON "SellingEntity"("key");
