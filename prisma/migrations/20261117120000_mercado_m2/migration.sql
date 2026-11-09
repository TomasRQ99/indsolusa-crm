-- CreateTable
CREATE TABLE "AccountAlias" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TRADE',
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountInsight" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plantId" TEXT,
    "block" TEXT NOT NULL,
    "topic" TEXT,
    "area" TEXT,
    "step" TEXT,
    "condition" TEXT,
    "statement" TEXT NOT NULL,
    "evidence" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalledAsset" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "process" TEXT,
    "line" TEXT,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "operationalRole" TEXT,
    "redundancy" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "criticalWhy" TEXT,
    "knownComponents" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactProfile" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "assetId" TEXT,
    "scope" TEXT NOT NULL,
    "stopsLine" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "timeToImpact" TEXT,
    "level" TEXT NOT NULL DEFAULT 'REPORTED',
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "costPerHourMin" DECIMAL(16,2),
    "costPerHourMax" DECIMAL(16,2),
    "unitsPerHour" DECIMAL(14,2),
    "contributionUnit" DECIMAL(16,2),
    "scrapPerHour" DECIMAL(16,2),
    "idleLaborPerHour" DECIMAL(16,2),
    "restartCost" DECIMAL(16,2),
    "basis" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plantId" TEXT,
    "area" TEXT,
    "role" TEXT,
    "startedOn" TIMESTAMP(3),
    "endedOn" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountAlias_accountId_name_key" ON "AccountAlias"("accountId", "name");

-- CreateIndex
CREATE INDEX "AccountInsight_accountId_block_idx" ON "AccountInsight"("accountId", "block");

-- CreateIndex
CREATE INDEX "InstalledAsset_plantId_idx" ON "InstalledAsset"("plantId");

-- CreateIndex
CREATE INDEX "ImpactProfile_plantId_idx" ON "ImpactProfile"("plantId");

-- CreateIndex
CREATE INDEX "Employment_accountId_idx" ON "Employment"("accountId");

-- CreateIndex
CREATE INDEX "Employment_contactId_idx" ON "Employment"("contactId");

-- AddForeignKey
ALTER TABLE "AccountAlias" ADD CONSTRAINT "AccountAlias_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountInsight" ADD CONSTRAINT "AccountInsight_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountInsight" ADD CONSTRAINT "AccountInsight_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledAsset" ADD CONSTRAINT "InstalledAsset_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactProfile" ADD CONSTRAINT "ImpactProfile_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactProfile" ADD CONSTRAINT "ImpactProfile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InstalledAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

