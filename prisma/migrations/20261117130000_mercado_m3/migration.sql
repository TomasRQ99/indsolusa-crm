-- CreateTable
CREATE TABLE "IntelligenceSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "mapping" JSONB,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetImport" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "headers" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "scale" TEXT,
    "currency" TEXT,
    "decimalStyle" TEXT,
    "fixedYear" INTEGER,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "failure" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "committedByName" TEXT,

    CONSTRAINT "DatasetImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "nit" TEXT,
    "year" INTEGER,
    "name" TEXT,
    "parsed" JSONB,
    "status" TEXT NOT NULL,
    "messages" TEXT[],
    "decision" TEXT,

    CONSTRAINT "DatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCompany" (
    "id" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "otherNames" TEXT[],
    "ciiu" TEXT,
    "sector" TEXT,
    "department" TEXT,
    "city" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitsScale" TEXT NOT NULL,
    "revenue" DECIMAL(22,2),
    "operatingIncome" DECIMAL(22,2),
    "netIncome" DECIMAL(22,2),
    "assets" DECIMAL(22,2),
    "liabilities" DECIMAL(22,2),
    "equity" DECIMAL(22,2),
    "currentAssets" DECIMAL(22,2),
    "currentLiabilities" DECIMAL(22,2),
    "debt" DECIMAL(22,2),
    "employees" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceSource_name_key" ON "IntelligenceSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetImport_hash_key" ON "DatasetImport"("hash");

-- CreateIndex
CREATE INDEX "DatasetRow_importId_status_idx" ON "DatasetRow"("importId", "status");

-- CreateIndex
CREATE INDEX "DatasetRow_importId_nit_year_idx" ON "DatasetRow"("importId", "nit", "year");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCompany_nit_key" ON "MarketCompany"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCompany_accountId_key" ON "MarketCompany"("accountId");

-- CreateIndex
CREATE INDEX "MarketCompany_name_idx" ON "MarketCompany"("name");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_fiscalYear_idx" ON "FinancialSnapshot"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSnapshot_companyId_fiscalYear_importId_key" ON "FinancialSnapshot"("companyId", "fiscalYear", "importId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSetting_key_version_key" ON "MarketSetting"("key", "version");

-- AddForeignKey
ALTER TABLE "DatasetImport" ADD CONSTRAINT "DatasetImport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntelligenceSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRow" ADD CONSTRAINT "DatasetRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DatasetImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCompany" ADD CONSTRAINT "MarketCompany_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "MarketCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntelligenceSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DatasetImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

