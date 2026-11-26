-- CreateTable
CREATE TABLE "SalesShare" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBudgetSite" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "SalesBudgetSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesShare_userId_idx" ON "SalesShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesShare_dealId_userId_key" ON "SalesShare"("dealId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesBudgetSite_budgetId_plantId_key" ON "SalesBudgetSite"("budgetId", "plantId");

-- AddForeignKey
ALTER TABLE "SalesShare" ADD CONSTRAINT "SalesShare_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBudgetSite" ADD CONSTRAINT "SalesBudgetSite_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "SalesBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBudgetSite" ADD CONSTRAINT "SalesBudgetSite_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

