-- CreateTable
CREATE TABLE "SalesHistoryBatch" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unit" INTEGER NOT NULL DEFAULT 1,
    "raw" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CHECKED',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "SalesHistoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesHistoryMonth" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "month" TEXT NOT NULL,
    "kpi" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "orig" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(10,2),
    "source" TEXT NOT NULL,

    CONSTRAINT "SalesHistoryMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesHistoryMonth_accountId_month_idx" ON "SalesHistoryMonth"("accountId", "month");

-- CreateIndex
CREATE INDEX "SalesHistoryMonth_userId_idx" ON "SalesHistoryMonth"("userId");

-- CreateIndex
CREATE INDEX "SalesHistoryMonth_batchId_idx" ON "SalesHistoryMonth"("batchId");

-- AddForeignKey
ALTER TABLE "SalesHistoryMonth" ADD CONSTRAINT "SalesHistoryMonth_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalesHistoryBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesHistoryMonth" ADD CONSTRAINT "SalesHistoryMonth_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

