-- CreateTable
CREATE TABLE "EsagaraException" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "saleAmount" DECIMAL(14,2) NOT NULL,
    "esagaraAmount" DECIMAL(14,2) NOT NULL,
    "esagaraPct" DECIMAL(7,2) NOT NULL,
    "thresholdPct" DECIMAL(7,2) NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "expectedBenefit" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "alternatives" TEXT,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "EsagaraException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EsagaraException_status_idx" ON "EsagaraException"("status");

-- CreateIndex
CREATE INDEX "EsagaraException_quoteId_idx" ON "EsagaraException"("quoteId");

-- CreateIndex
CREATE INDEX "EsagaraException_accountId_idx" ON "EsagaraException"("accountId");

-- AddForeignKey
ALTER TABLE "EsagaraException" ADD CONSTRAINT "EsagaraException_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
