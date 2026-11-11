-- CreateTable
CREATE TABLE "Warranty" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "serial" TEXT,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL,
    "terms" TEXT,
    "supplierName" TEXT,
    "supplierMonths" INTEGER,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerClaim" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "warrantyId" TEXT,
    "kind" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "reportedBy" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "responsible" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "costUsd" DECIMAL(14,2),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimNote" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductExperience" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "manufacturer" TEXT,
    "title" TEXT NOT NULL,
    "application" TEXT,
    "industry" TEXT,
    "summary" TEXT NOT NULL,
    "dealId" TEXT,
    "eligibility" TEXT NOT NULL DEFAULT 'INTERNAL_ONLY',
    "customerApproval" TEXT,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "draft" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductExperience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Warranty_dealId_idx" ON "Warranty"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerClaim_code_key" ON "CustomerClaim"("code");

-- CreateIndex
CREATE INDEX "CustomerClaim_dealId_idx" ON "CustomerClaim"("dealId");

-- CreateIndex
CREATE INDEX "ClaimNote_claimId_idx" ON "ClaimNote"("claimId");

-- CreateIndex
CREATE INDEX "ProductExperience_code_idx" ON "ProductExperience"("code");

-- AddForeignKey
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerClaim" ADD CONSTRAINT "CustomerClaim_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerClaim" ADD CONSTRAINT "CustomerClaim_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimNote" ADD CONSTRAINT "ClaimNote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "CustomerClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExperience" ADD CONSTRAINT "ProductExperience_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

