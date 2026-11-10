-- CreateTable
CREATE TABLE "VisitPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plantId" TEXT,
    "ownerId" TEXT NOT NULL,
    "missionId" TEXT,
    "plannedAt" TIMESTAMP(3),
    "unplanned" BOOLEAN NOT NULL DEFAULT false,
    "objectives" JSONB NOT NULL DEFAULT '[]',
    "meetWith" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "happenedAt" TIMESTAMP(3),
    "learned" TEXT,
    "objectivesMet" JSONB,
    "nextMove" TEXT,
    "nextMoveDate" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitCommitment" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "dealId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialMission" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "travelNote" TEXT,
    "budgetStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "budgetAmount" DECIMAL(14,2),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialMission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitPlan_ownerId_status_idx" ON "VisitPlan"("ownerId", "status");

-- CreateIndex
CREATE INDEX "VisitPlan_accountId_idx" ON "VisitPlan"("accountId");

-- CreateIndex
CREATE INDEX "VisitCommitment_visitId_idx" ON "VisitCommitment"("visitId");

-- AddForeignKey
ALTER TABLE "VisitPlan" ADD CONSTRAINT "VisitPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPlan" ADD CONSTRAINT "VisitPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPlan" ADD CONSTRAINT "VisitPlan_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "CommercialMission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitCommitment" ADD CONSTRAINT "VisitCommitment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "VisitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialMission" ADD CONSTRAINT "CommercialMission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
