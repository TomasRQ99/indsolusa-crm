-- AlterTable
ALTER TABLE "CommercialMission" ADD COLUMN     "advanceAmount" DECIMAL(14,2),
ADD COLUMN     "advanceGivenAt" TIMESTAMP(3),
ADD COLUMN     "advanceGivenByName" TEXT,
ADD COLUMN     "advanceRef" TEXT,
ADD COLUMN     "budgetId" TEXT,
ADD COLUMN     "settleAmount" DECIMAL(14,2),
ADD COLUMN     "settleRef" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledByName" TEXT;

-- AlterTable
ALTER TABLE "MarketSetting" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "MissionExpense" ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcomeByName" TEXT,
ADD COLUMN     "outcomeNote" TEXT;

-- CreateTable
CREATE TABLE "CashBalance" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "confirmedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReserve" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "authorityName" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedByName" TEXT,
    "releaseNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashPlanItem" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dueOn" TIMESTAMP(3) NOT NULL,
    "repeat" TEXT NOT NULL DEFAULT 'NONE',
    "repeatUntil" TIMESTAMP(3),
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedByName" TEXT,
    "endedNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierPoId" TEXT,
    "internalPurchaseId" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountUsd" DECIMAL(14,2),
    "discountPct" DECIMAL(5,2),
    "discountUntil" TIMESTAMP(3),
    "lateImpact" TEXT,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "serviceAcceptedAt" TIMESTAMP(3),
    "serviceAcceptedByName" TEXT,
    "serviceAcceptNote" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionByName" TEXT,
    "exceptionNote" TEXT,
    "payApprovedAt" TIMESTAMP(3),
    "payApprovedByName" TEXT,
    "payApprovedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT,
    "paidByName" TEXT,
    "recordedByName" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(14,2) NOT NULL,
    "forecast" DECIMAL(14,2),
    "forecastNote" TEXT,
    "forecastAt" TIMESTAMP(3),
    "forecastByName" TEXT,
    "approvedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetEntry" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "on" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalPurchase" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "need" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountUsd" DECIMAL(14,2) NOT NULL,
    "budgetId" TEXT,
    "requesterId" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3),
    "tco" JSONB,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "level" INTEGER NOT NULL,
    "overBudget" DECIMAL(14,2),
    "exceptionReason" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "delegationId" TEXT,
    "policyVersion" INTEGER NOT NULL DEFAULT 0,
    "boughtAt" TIMESTAMP(3),
    "boughtNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "legalOwner" TEXT NOT NULL,
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "acquiredOn" TIMESTAMP(3),
    "serial" TEXT,
    "internalPurchaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACQUIRED',
    "custodianId" TEXT,
    "location" TEXT,
    "warrantyUntil" TIMESTAMP(3),
    "insurer" TEXT,
    "insuranceUntil" TIMESTAMP(3),
    "nextMaintenanceOn" TIMESTAMP(3),
    "documentsNote" TEXT,
    "plate" TEXT,
    "odometerKm" INTEGER,
    "disposedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "fromName" TEXT,
    "toUserId" TEXT,
    "toName" TEXT,
    "location" TEXT,
    "odometerKm" INTEGER,
    "costUsd" DECIMAL(14,2),
    "note" TEXT,
    "evidence" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "renewal" TEXT NOT NULL DEFAULT 'NONE',
    "noticeDays" INTEGER,
    "moneyDirection" TEXT NOT NULL DEFAULT 'NONE',
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequency" TEXT,
    "nextDueOn" TIMESTAMP(3),
    "material" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "evidence" TEXT,
    "notes" TEXT,
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "endedNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT,
    "bond" TEXT,
    "employer" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "location" TEXT,
    "vacationDaysPerYear" DECIMAL(5,1),
    "documentsNote" TEXT,
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonCompensation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "benefitsNote" TEXT,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractualTitle" TEXT NOT NULL,
    "operatingRole" TEXT NOT NULL,
    "unit" TEXT,
    "leaderId" TEXT,
    "location" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "evidence" TEXT,
    "requestedByName" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegatedAuthority" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "limitUsd" DECIMAL(14,2),
    "scopeNote" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegatedAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportGap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "impact" TEXT,
    "ownerId" TEXT NOT NULL,
    "nextMovement" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "escalatedAt" TIMESTAMP(3),
    "escalatedNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "raisedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingExport" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "rows" INTEGER NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashBalance_bankAccountId_observedAt_idx" ON "CashBalance"("bankAccountId", "observedAt");

-- CreateIndex
CREATE INDEX "CashPlanItem_dueOn_idx" ON "CashPlanItem"("dueOn");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierPoId_idx" ON "SupplierInvoice"("supplierPoId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_dueAt_idx" ON "SupplierInvoice"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_supplierId_number_key" ON "SupplierInvoice"("supplierId", "number");

-- CreateIndex
CREATE INDEX "BudgetEntry_budgetId_idx" ON "BudgetEntry"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalPurchase_code_key" ON "InternalPurchase"("code");

-- CreateIndex
CREATE INDEX "InternalPurchase_status_idx" ON "InternalPurchase"("status");

-- CreateIndex
CREATE INDEX "InternalPurchase_budgetId_idx" ON "InternalPurchase"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_internalPurchaseId_key" ON "Asset"("internalPurchaseId");

-- CreateIndex
CREATE INDEX "Asset_custodianId_idx" ON "Asset"("custodianId");

-- CreateIndex
CREATE INDEX "AssetEvent_assetId_idx" ON "AssetEvent"("assetId");

-- CreateIndex
CREATE INDEX "Obligation_status_endsOn_idx" ON "Obligation"("status", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAdmin_userId_key" ON "PersonAdmin"("userId");

-- CreateIndex
CREATE INDEX "PersonCompensation_userId_effectiveFrom_idx" ON "PersonCompensation"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PersonRoleAssignment_userId_effectiveFrom_idx" ON "PersonRoleAssignment"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AbsenceRecord_userId_startsOn_idx" ON "AbsenceRecord"("userId", "startsOn");

-- CreateIndex
CREATE INDEX "DelegatedAuthority_toUserId_endsAt_idx" ON "DelegatedAuthority"("toUserId", "endsAt");

-- CreateIndex
CREATE INDEX "SupportGap_status_idx" ON "SupportGap"("status");

-- CreateIndex
CREATE INDEX "DomainEvent_name_occurredAt_idx" ON "DomainEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_occurredAt_idx" ON "DomainEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "CommercialMission" ADD CONSTRAINT "CommercialMission_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBalance" ADD CONSTRAINT "CashBalance_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_internalPurchaseId_fkey" FOREIGN KEY ("internalPurchaseId") REFERENCES "InternalPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPurchase" ADD CONSTRAINT "InternalPurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPurchase" ADD CONSTRAINT "InternalPurchase_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPurchase" ADD CONSTRAINT "InternalPurchase_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_internalPurchaseId_fkey" FOREIGN KEY ("internalPurchaseId") REFERENCES "InternalPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAdmin" ADD CONSTRAINT "PersonAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCompensation" ADD CONSTRAINT "PersonCompensation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRoleAssignment" ADD CONSTRAINT "PersonRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRoleAssignment" ADD CONSTRAINT "PersonRoleAssignment_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegatedAuthority" ADD CONSTRAINT "DelegatedAuthority_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegatedAuthority" ADD CONSTRAINT "DelegatedAuthority_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportGap" ADD CONSTRAINT "SupportGap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportGap" ADD CONSTRAINT "SupportGap_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Expenses of trips reconciled before this module were accepted as a whole: record that outcome on each one,
-- so the new rule (no expense counts without its own outcome) holds for history too.
UPDATE "MissionExpense" e SET "outcome" = 'VALID', "outcomeByName" = m."reconciledByName", "outcomeNote" = 'Legalizado antes del Módulo 14'
FROM "CommercialMission" m WHERE e."missionId" = m."id" AND m."expensesStatus" = 'RECONCILED' AND e."outcome" IS NULL;
