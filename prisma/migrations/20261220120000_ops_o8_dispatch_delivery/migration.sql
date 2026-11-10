-- CreateTable
CREATE TABLE "DispatchOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "instructionId" TEXT,
    "lines" JSONB NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "resourceName" TEXT,
    "tracking" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "scheduledByName" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedByName" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveryId" TEXT,
    "cost" DECIMAL(14,2),
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "costNote" TEXT,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "customerHoldReason" TEXT,
    "customerHoldSince" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "cause" TEXT,
    "reason" TEXT,
    "receiverName" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvidence" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRequirement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "phase" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOrder_code_key" ON "DispatchOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOrder_deliveryId_key" ON "DispatchOrder"("deliveryId");

-- CreateIndex
CREATE INDEX "DispatchOrder_dealId_idx" ON "DispatchOrder"("dealId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_orderId_idx" ON "DeliveryAttempt"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryEvidence_orderId_idx" ON "DeliveryEvidence"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryRequirement_accountId_idx" ON "DeliveryRequirement"("accountId");

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DispatchOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvidence" ADD CONSTRAINT "DeliveryEvidence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DispatchOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRequirement" ADD CONSTRAINT "DeliveryRequirement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "billingBasis" TEXT NOT NULL DEFAULT 'UPON_DELIVERY';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "receptionAt" TIMESTAMP(3),
ADD COLUMN     "receptionKind" TEXT;

