-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MARKETING';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "taxId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "explorationId" TEXT;

-- CreateTable
CREATE TABLE "Exploration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "hypothesis" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'INDUSTRY',
    "scopeText" TEXT,
    "ownerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextReviewAt" TIMESTAMP(3),
    "movement" TEXT NOT NULL DEFAULT 'CLARITY_NEEDED',
    "nextMove" TEXT,
    "nextMoveAt" TIMESTAMP(3),
    "waitingFor" TEXT,
    "waitingUntil" TIMESTAMP(3),
    "triggerOn" TIMESTAMP(3),
    "triggerEvent" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
    "resultSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdFromSignalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exploration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExplorationLink" (
    "id" TEXT NOT NULL,
    "explorationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "why" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExplorationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "whyMatters" TEXT,
    "accountId" TEXT,
    "plantId" TEXT,
    "explorationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "dismissedNote" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedById" TEXT,
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "why" TEXT,
    "explorationId" TEXT,
    "accountId" TEXT,
    "plantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answerSource" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhiteSpace" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "why" TEXT,
    "accountId" TEXT,
    "explorationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WhiteSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "operationType" TEXT,
    "notes" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FutureOpportunity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accountId" TEXT,
    "plantId" TEXT,
    "process" TEXT,
    "explorationId" TEXT,
    "expectedAt" TIMESTAMP(3),
    "triggerOn" TIMESTAMP(3),
    "triggerEvent" TEXT,
    "ownerId" TEXT,
    "impact" TEXT,
    "valueBasis" TEXT,
    "gaps" TEXT,
    "nextMove" TEXT,
    "nextMoveAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedNote" TEXT,
    "dealId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'REPORTED',
    "capturedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FutureOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exploration_lifecycle_movement_idx" ON "Exploration"("lifecycle", "movement");

-- CreateIndex
CREATE UNIQUE INDEX "ExplorationLink_explorationId_kind_refId_key" ON "ExplorationLink"("explorationId", "kind", "refId");

-- CreateIndex
CREATE INDEX "MarketSignal_status_idx" ON "MarketSignal"("status");

-- CreateIndex
CREATE INDEX "KnowledgeGap_status_idx" ON "KnowledgeGap"("status");

-- CreateIndex
CREATE INDEX "WhiteSpace_status_idx" ON "WhiteSpace"("status");

-- CreateIndex
CREATE INDEX "Plant_accountId_idx" ON "Plant"("accountId");

-- CreateIndex
CREATE INDEX "FutureOpportunity_status_expectedAt_idx" ON "FutureOpportunity"("status", "expectedAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exploration" ADD CONSTRAINT "Exploration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExplorationLink" ADD CONSTRAINT "ExplorationLink_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteSpace" ADD CONSTRAINT "WhiteSpace_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhiteSpace" ADD CONSTRAINT "WhiteSpace_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureOpportunity" ADD CONSTRAINT "FutureOpportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureOpportunity" ADD CONSTRAINT "FutureOpportunity_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureOpportunity" ADD CONSTRAINT "FutureOpportunity_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FutureOpportunity" ADD CONSTRAINT "FutureOpportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
