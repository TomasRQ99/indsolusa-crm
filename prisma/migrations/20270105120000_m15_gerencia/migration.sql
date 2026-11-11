-- CreateTable
CREATE TABLE "StrategicPriority" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "desiredOutcome" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "horizonTo" TIMESTAMP(3),
    "indicators" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT NOT NULL,
    "narrative" TEXT,
    "narrativeAt" TIMESTAMP(3),
    "narrativeByName" TEXT,
    "nextReviewOn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "closedNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicPriorityLink" (
    "id" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "note" TEXT,
    "addedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicPriorityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicPriorityReview" (
    "id" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "nextReviewOn" TIMESTAMP(3),
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategicPriorityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementDecision" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "revisionReason" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "area" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "whyNow" TEXT,
    "impact" TEXT NOT NULL,
    "impactUsd" DECIMAL(14,2),
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "facts" TEXT NOT NULL,
    "assumptions" TEXT,
    "risks" TEXT,
    "recommendation" TEXT,
    "deadline" TIMESTAMP(3),
    "sourceHref" TEXT,
    "sourceLabel" TEXT,
    "scenarioId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" TEXT,
    "chosen" TEXT,
    "rationale" TEXT,
    "authority" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expectedConsequence" TEXT,
    "followUpOn" TIMESTAMP(3),
    "ownerAfterId" TEXT,
    "withdrawnNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementDecisionReview" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actualConsequence" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "nextFollowUpOn" TIMESTAMP(3),
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementDecisionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "sourceHref" TEXT,
    "sourceLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "growthNote" TEXT,
    "nextMove" TEXT,
    "nextMoveOn" TIMESTAMP(3),
    "executiveId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedNote" TEXT,
    "endedByName" TEXT,

    CONSTRAINT "StrategicAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIdentity" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "slogan" TEXT NOT NULL,
    "valueProposition" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "principles" JSONB NOT NULL DEFAULT '[]',
    "methodologies" JSONB NOT NULL DEFAULT '[]',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedByName" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunctionCharter" (
    "id" TEXT NOT NULL,
    "functionKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "contribution" TEXT,
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "responsibilities" JSONB NOT NULL DEFAULT '[]',
    "decisionRights" JSONB NOT NULL DEFAULT '[]',
    "interfaces" JSONB NOT NULL DEFAULT '[]',
    "resources" TEXT,
    "ownerId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedByName" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunctionCharter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementSnapshot" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategicPriority_status_idx" ON "StrategicPriority"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicPriorityLink_priorityId_kind_refId_key" ON "StrategicPriorityLink"("priorityId", "kind", "refId");

-- CreateIndex
CREATE INDEX "StrategicPriorityReview_priorityId_createdAt_idx" ON "StrategicPriorityReview"("priorityId", "createdAt");

-- CreateIndex
CREATE INDEX "ManagementDecision_status_supersededAt_idx" ON "ManagementDecision"("status", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementDecision_code_version_key" ON "ManagementDecision"("code", "version");

-- CreateIndex
CREATE INDEX "ManagementDecisionReview_decisionId_createdAt_idx" ON "ManagementDecisionReview"("decisionId", "createdAt");

-- CreateIndex
CREATE INDEX "Scenario_status_idx" ON "Scenario"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicAccount_accountId_key" ON "StrategicAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIdentity_version_key" ON "CompanyIdentity"("version");

-- CreateIndex
CREATE UNIQUE INDEX "FunctionCharter_functionKey_version_key" ON "FunctionCharter"("functionKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementSnapshot_day_key" ON "ManagementSnapshot"("day");

-- AddForeignKey
ALTER TABLE "StrategicPriority" ADD CONSTRAINT "StrategicPriority_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicPriorityLink" ADD CONSTRAINT "StrategicPriorityLink_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "StrategicPriority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicPriorityReview" ADD CONSTRAINT "StrategicPriorityReview_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "StrategicPriority"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementDecision" ADD CONSTRAINT "ManagementDecision_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementDecision" ADD CONSTRAINT "ManagementDecision_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementDecision" ADD CONSTRAINT "ManagementDecision_ownerAfterId_fkey" FOREIGN KEY ("ownerAfterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementDecisionReview" ADD CONSTRAINT "ManagementDecisionReview_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "ManagementDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicAccount" ADD CONSTRAINT "StrategicAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicAccount" ADD CONSTRAINT "StrategicAccount_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunctionCharter" ADD CONSTRAINT "FunctionCharter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Módulo 15 §22: the identity in force at the cut of 09-Nov-2026, as written in the official document, becomes
-- version 1. Gerencia publishes every later version from SOLU. Principles carry no meaning yet and the
-- methodologies list is empty: the document names neither, so nothing is invented here.
INSERT INTO "CompanyIdentity" ("id", "version", "purpose", "slogan", "valueProposition", "attributes", "principles", "methodologies", "effectiveFrom", "reason", "approvedByName")
VALUES (
  'identity-base-v1', 1,
  'Que la industria no se detenga.',
  'Más Rápidamente, No te Detengas.',
  'Mantener la industria operando mediante localización, compra, financiación cuando aplique, coordinación y entrega de soluciones industriales con rapidez, información oportuna, acompañamiento y capacidad de ejecución.',
  '["Rapidez","6 oficinas + 220 aliados","Financiación local cuando aplique","Capacidad de pago anticipado","Información oportuna","Garantía","Acompañamiento","25+ años"]'::jsonb,
  '[{"name":"Verdad","meaning":""},{"name":"Humildad","meaning":""},{"name":"Respeto","meaning":""},{"name":"Transparencia / Cristalinidad","meaning":""},{"name":"Trabajo en Equipo","meaning":""},{"name":"Responsabilidad","meaning":""}]'::jsonb,
  '[]'::jsonb,
  '2026-11-09T00:00:00.000Z',
  'Identidad base vigente al corte del 09-nov-2026 (documento oficial del Módulo 15, v1.2, §22).',
  'Documento oficial Módulo 15 v1.2'
);

-- Módulo 15 §23 and Módulo 16 §19: the five functions with their frozen purpose, word for word. Everything else
-- (owner, outputs, decisions, interfaces, resources) is empty until Gerencia publishes it, and shows as a gap.
INSERT INTO "FunctionCharter" ("id", "functionKey", "version", "purpose", "effectiveFrom", "reason", "publishedByName") VALUES
  ('charter-mercadeo-v1', 'MERCADEO', 1, 'Explora el mercado.', '2026-11-09T00:00:00.000Z', 'Propósito congelado en los documentos oficiales (corte 09-nov-2026).', 'Documento oficial Módulo 16 v1.1'),
  ('charter-comercial-v1', 'COMERCIAL', 1, 'Transa soluciones.', '2026-11-09T00:00:00.000Z', 'Propósito congelado en los documentos oficiales (corte 09-nov-2026).', 'Documento oficial Módulo 16 v1.1'),
  ('charter-operaciones-v1', 'OPERACIONES', 1, 'Cumple con las soluciones.', '2026-11-09T00:00:00.000Z', 'Propósito congelado en los documentos oficiales (corte 09-nov-2026).', 'Documento oficial Módulo 16 v1.1'),
  ('charter-administracion-v1', 'ADMINISTRACION', 1, 'Administra los recursos de la empresa.', '2026-11-09T00:00:00.000Z', 'Propósito congelado en los documentos oficiales (corte 09-nov-2026).', 'Documento oficial Módulo 16 v1.1'),
  ('charter-gerencia-v1', 'GERENCIA', 1, 'Coordina el presente y nos lleva hacia la dirección elegida para el futuro.', '2026-11-09T00:00:00.000Z', 'Propósito congelado en los documentos oficiales (corte 09-nov-2026).', 'Documento oficial Módulo 16 v1.1');
