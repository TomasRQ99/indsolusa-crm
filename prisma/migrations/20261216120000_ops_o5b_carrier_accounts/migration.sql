-- CreateTable
CREATE TABLE "CarrierAccount" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "sellerKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accountLast4" TEXT,
    "country" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "secretRef" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierIntegrationAttempt" (
    "id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "accountId" TEXT,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "shipmentId" TEXT,
    "supplierPoId" TEXT,
    "request" JSONB,
    "response" JSONB,
    "error" TEXT,
    "byName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CarrierIntegrationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierAccount_secretRef_key" ON "CarrierAccount"("secretRef");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierIntegrationAttempt_idempotencyKey_key" ON "CarrierIntegrationAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CarrierIntegrationAttempt_shipmentId_idx" ON "CarrierIntegrationAttempt"("shipmentId");

-- CreateIndex
CREATE INDEX "CarrierIntegrationAttempt_state_idx" ON "CarrierIntegrationAttempt"("state");
