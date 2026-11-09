
-- CreateTable
CREATE TABLE "ScopeLine" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "component" TEXT NOT NULL,
    "code" TEXT,
    "manufacturer" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "family" TEXT,
    "requested" BOOLEAN NOT NULL DEFAULT false,
    "requiredForFunction" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'TO_CONFIRM',
    "identity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "condition" TEXT,
    "alternativesAllowed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "source" TEXT,
    "confirmationId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalFact" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "scopeLineId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REPORTED',
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "TechnicalFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeConfirmation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRelationship" (
    "id" TEXT NOT NULL,
    "fromKey" TEXT NOT NULL,
    "fromLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ProductRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeLine_dealId_idx" ON "ScopeLine"("dealId");

-- CreateIndex
CREATE INDEX "TechnicalFact_dealId_idx" ON "TechnicalFact"("dealId");

-- CreateIndex
CREATE INDEX "TechnicalFact_scopeLineId_idx" ON "TechnicalFact"("scopeLineId");

-- CreateIndex
CREATE INDEX "ScopeConfirmation_dealId_idx" ON "ScopeConfirmation"("dealId");

-- CreateIndex
CREATE INDEX "ProductRelationship_fromKey_idx" ON "ProductRelationship"("fromKey");

-- CreateIndex
CREATE INDEX "ProductRelationship_toKey_idx" ON "ProductRelationship"("toKey");

-- AddForeignKey
ALTER TABLE "ScopeLine" ADD CONSTRAINT "ScopeLine_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeLine" ADD CONSTRAINT "ScopeLine_confirmationId_fkey" FOREIGN KEY ("confirmationId") REFERENCES "ScopeConfirmation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalFact" ADD CONSTRAINT "TechnicalFact_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalFact" ADD CONSTRAINT "TechnicalFact_scopeLineId_fkey" FOREIGN KEY ("scopeLineId") REFERENCES "ScopeLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeConfirmation" ADD CONSTRAINT "ScopeConfirmation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

