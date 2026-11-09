-- CreateTable
CREATE TABLE "PaymentBehaviorSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedDays" INTEGER,
    "avgDelay" DOUBLE PRECISION,
    "onTimePct" DOUBLE PRECISION,
    "trend" TEXT NOT NULL,
    "collected" INTEGER NOT NULL,
    "openTotal" DECIMAL(14,2) NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentBehaviorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentBehaviorSnapshot_accountId_createdAt_idx" ON "PaymentBehaviorSnapshot"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentBehaviorSnapshot" ADD CONSTRAINT "PaymentBehaviorSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
