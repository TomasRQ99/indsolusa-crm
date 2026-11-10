-- CreateTable
CREATE TABLE "PurchaseApproval" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "relatedTotal" DECIMAL(14,2) NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "stockAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestNote" TEXT,
    "context" JSONB NOT NULL,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "escalatedByName" TEXT,
    "policyVersion" INTEGER NOT NULL,

    CONSTRAINT "PurchaseApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseApproval_prId_idx" ON "PurchaseApproval"("prId");

-- CreateIndex
CREATE INDEX "PurchaseApproval_status_idx" ON "PurchaseApproval"("status");

-- AddForeignKey
ALTER TABLE "PurchaseApproval" ADD CONSTRAINT "PurchaseApproval_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
