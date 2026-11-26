-- CreateTable
CREATE TABLE "SalesBudget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "accountId" TEXT,
    "slot" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "assumptions" JSONB NOT NULL,
    "potential" TEXT,
    "strategy" TEXT,
    "justification" TEXT,
    "versionReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "supersededAt" TIMESTAMP(3),
    "reconcileNote" TEXT,
    "reconcileByName" TEXT,
    "reconcileAt" TIMESTAMP(3),

    CONSTRAINT "SalesBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "kpi" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "suggested" DECIMAL(18,2),
    "origin" TEXT NOT NULL,

    CONSTRAINT "SalesBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBudgetEvent" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "detail" JSONB,

    CONSTRAINT "SalesBudgetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBudgetYear" (
    "year" INTEGER NOT NULL,
    "corporate" JSONB,
    "corporateByName" TEXT,
    "corporateAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesBudgetYear_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "TrmDay" (
    "day" TEXT NOT NULL,
    "validTo" TEXT NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrmDay_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "SalesBudget_year_userId_idx" ON "SalesBudget"("year", "userId");

-- CreateIndex
CREATE INDEX "SalesBudget_accountId_idx" ON "SalesBudget"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesBudget_year_slot_userId_version_key" ON "SalesBudget"("year", "slot", "userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SalesBudgetLine_budgetId_month_kpi_key" ON "SalesBudgetLine"("budgetId", "month", "kpi");

-- CreateIndex
CREATE INDEX "SalesBudgetEvent_budgetId_idx" ON "SalesBudgetEvent"("budgetId");

-- AddForeignKey
ALTER TABLE "SalesBudget" ADD CONSTRAINT "SalesBudget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBudget" ADD CONSTRAINT "SalesBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBudgetLine" ADD CONSTRAINT "SalesBudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "SalesBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBudgetEvent" ADD CONSTRAINT "SalesBudgetEvent_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "SalesBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

