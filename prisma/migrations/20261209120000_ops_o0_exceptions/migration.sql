-- CreateTable
CREATE TABLE "OperationalException" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "supplierPoId" TEXT,
    "shipmentId" TEXT,
    "kind" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "customerImpact" TEXT,
    "economicImpactUsd" DECIMAL(14,2),
    "evidence" TEXT,
    "rootHypothesis" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "recommended" TEXT NOT NULL,
    "impactAreas" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalException_status_deadline_idx" ON "OperationalException"("status", "deadline");

-- CreateIndex
CREATE INDEX "OperationalException_dealId_idx" ON "OperationalException"("dealId");

-- AddForeignKey
ALTER TABLE "OperationalException" ADD CONSTRAINT "OperationalException_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalException" ADD CONSTRAINT "OperationalException_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
