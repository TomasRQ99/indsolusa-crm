-- CreateTable
CREATE TABLE "SalesForecast" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT NOT NULL,
    "cutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "estOc" DECIMAL(18,2) NOT NULL,
    "estFact" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,

    CONSTRAINT "SalesForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesForecastLine" (
    "id" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "kpi" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SalesForecastLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "byAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailedAt" TIMESTAMP(3),

    CONSTRAINT "SalesInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBudgetSetting" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "eveningMail" BOOLEAN NOT NULL DEFAULT false,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesBudgetSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesForecast_year_slot_userId_idx" ON "SalesForecast"("year", "slot", "userId");

-- CreateIndex
CREATE INDEX "SalesForecast_accountId_idx" ON "SalesForecast"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesForecastLine_forecastId_month_kpi_key" ON "SalesForecastLine"("forecastId", "month", "kpi");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInsight_userId_day_key" ON "SalesInsight"("userId", "day");

-- AddForeignKey
ALTER TABLE "SalesForecast" ADD CONSTRAINT "SalesForecast_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesForecastLine" ADD CONSTRAINT "SalesForecastLine_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "SalesForecast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

