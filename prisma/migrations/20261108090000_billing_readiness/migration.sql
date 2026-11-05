-- CreateEnum
CREATE TYPE "AccountingSync" AS ENUM ('NOT_SENT', 'SENT', 'CONFIRMED', 'UNCERTAIN');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "allowsPartialBilling" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "billingContact" TEXT;

-- AlterTable
ALTER TABLE "CustomerPayment" ADD COLUMN     "residualNote" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSystem" TEXT,
ADD COLUMN     "partial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortPayNote" TEXT,
ADD COLUMN     "syncAt" TIMESTAMP(3),
ADD COLUMN     "syncNote" TEXT,
ADD COLUMN     "syncState" "AccountingSync" NOT NULL DEFAULT 'NOT_SENT';

-- CreateTable
CREATE TABLE "BillingRequest" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "kind" TEXT NOT NULL,
    "sentTo" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BillingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingRequest_dealId_idx" ON "BillingRequest"("dealId");

-- AddForeignKey
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

