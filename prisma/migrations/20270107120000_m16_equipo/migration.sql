-- AlterTable
ALTER TABLE "CoverageAssignment" ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedByName" TEXT,
ADD COLUMN     "scopeNote" TEXT;

-- AlterTable
ALTER TABLE "PersonRoleAssignment" ADD COLUMN     "acting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "charterVersion" INTEGER,
ADD COLUMN     "identityVersion" INTEGER,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByName" TEXT,
ADD COLUMN     "reviewedVersion" INTEGER,
ADD COLUMN     "roleProfileId" TEXT;

-- AlterTable
ALTER TABLE "SupportGap" ADD COLUMN     "expectation" TEXT;

-- CreateTable
CREATE TABLE "RoleProfile" (
    "id" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "functionKey" TEXT NOT NULL,
    "soluRole" TEXT,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL DEFAULT '[]',
    "functions" JSONB NOT NULL DEFAULT '[]',
    "responsibilities" JSONB NOT NULL DEFAULT '[]',
    "decisionRights" JSONB NOT NULL DEFAULT '[]',
    "authorityDomains" JSONB NOT NULL DEFAULT '[]',
    "boundaries" JSONB NOT NULL DEFAULT '[]',
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "customers" JSONB NOT NULL DEFAULT '[]',
    "qualityStandards" JSONB NOT NULL DEFAULT '[]',
    "behaviors" JSONB NOT NULL DEFAULT '[]',
    "methodologies" JSONB NOT NULL DEFAULT '[]',
    "performance" JSONB NOT NULL DEFAULT '[]',
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "rhythm" JSONB NOT NULL DEFAULT '[]',
    "successSignals" JSONB NOT NULL DEFAULT '[]',
    "attentionSignals" JSONB NOT NULL DEFAULT '[]',
    "careerLevels" JSONB NOT NULL DEFAULT '[]',
    "careerExpectations" JSONB NOT NULL DEFAULT '[]',
    "companyCommitments" JSONB NOT NULL DEFAULT '[]',
    "identityVersion" INTEGER,
    "charterVersion" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedByName" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "detail" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'PRIVATE',
    "source" TEXT NOT NULL DEFAULT 'SELF',
    "addedById" TEXT,
    "addedByName" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "label" TEXT,
    "result" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "takenOn" TIMESTAMP(3) NOT NULL,
    "privacy" TEXT NOT NULL DEFAULT 'PRIVATE',
    "addedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "behavior" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "observedOn" TIMESTAMP(3) NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'SHARED',
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "leaderId" TEXT,
    "mentorId" TEXT,
    "mentorKind" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "closedByName" TEXT,
    "previousId" TEXT,
    "policyVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentObjective" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT,
    "expectedEvidence" TEXT NOT NULL,
    "nextMovement" TEXT NOT NULL,
    "reviewOn" TIMESTAMP(3) NOT NULL,
    "privacy" TEXT NOT NULL DEFAULT 'SHARED',
    "origin" TEXT NOT NULL DEFAULT 'SELF',
    "originRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByName" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentEvidence" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "ref" TEXT,
    "observedOn" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SELF',
    "addedById" TEXT,
    "addedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentCommitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sharedWithId" TEXT,
    "objectiveId" TEXT,
    "meetingId" TEXT,
    "kind" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "expectedEvidence" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentMeeting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "withId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "heldOn" TIMESTAMP(3),
    "notes" TEXT,
    "agenda" JSONB,
    "planId" TEXT,
    "checkpointDay" INTEGER,
    "nextMeetingId" TEXT,
    "noNextReason" TEXT,
    "cancelReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "aboutId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "topic" TEXT,
    "continueText" TEXT,
    "startText" TEXT,
    "improveText" TEXT,
    "reduceText" TEXT,
    "requestedByName" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevelopmentOpportunity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "dimension" TEXT,
    "what" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "objectiveId" TEXT,
    "dismissNote" TEXT,
    "raisedById" TEXT,
    "raisedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevelopmentOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "level" TEXT,
    "state" TEXT NOT NULL,
    "gaps" TEXT,
    "evidence" TEXT NOT NULL,
    "plan" TEXT,
    "assessedById" TEXT,
    "assessedByName" TEXT NOT NULL,
    "assessedOn" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleBackup" (
    "id" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "holderId" TEXT,
    "backupUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BACKUP',
    "capabilityNote" TEXT,
    "note" TEXT,
    "setByName" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleGapReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "dimension" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "evidence" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT NOT NULL,
    "reviewedOn" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleGapReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleProfile_functionKey_idx" ON "RoleProfile"("functionKey");

-- CreateIndex
CREATE UNIQUE INDEX "RoleProfile_roleKey_version_key" ON "RoleProfile"("roleKey", "version");

-- CreateIndex
CREATE INDEX "ProfileEntry_userId_block_idx" ON "ProfileEntry"("userId", "block");

-- CreateIndex
CREATE INDEX "PersonAssessment_userId_idx" ON "PersonAssessment"("userId");

-- CreateIndex
CREATE INDEX "CharacterEvidence_userId_dimension_idx" ON "CharacterEvidence"("userId", "dimension");

-- CreateIndex
CREATE INDEX "DevelopmentPlan_userId_status_idx" ON "DevelopmentPlan"("userId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentObjective_planId_idx" ON "DevelopmentObjective"("planId");

-- CreateIndex
CREATE INDEX "DevelopmentEvidence_objectiveId_idx" ON "DevelopmentEvidence"("objectiveId");

-- CreateIndex
CREATE INDEX "DevelopmentCommitment_userId_status_idx" ON "DevelopmentCommitment"("userId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentCommitment_ownerId_status_idx" ON "DevelopmentCommitment"("ownerId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentMeeting_userId_scheduledOn_idx" ON "DevelopmentMeeting"("userId", "scheduledOn");

-- CreateIndex
CREATE INDEX "DevelopmentMeeting_withId_scheduledOn_idx" ON "DevelopmentMeeting"("withId", "scheduledOn");

-- CreateIndex
CREATE INDEX "Feedback_aboutId_idx" ON "Feedback"("aboutId");

-- CreateIndex
CREATE INDEX "Feedback_fromId_status_idx" ON "Feedback"("fromId", "status");

-- CreateIndex
CREATE INDEX "DevelopmentOpportunity_userId_status_idx" ON "DevelopmentOpportunity"("userId", "status");

-- CreateIndex
CREATE INDEX "ReadinessAssessment_userId_roleKey_idx" ON "ReadinessAssessment"("userId", "roleKey");

-- CreateIndex
CREATE INDEX "RoleBackup_roleKey_idx" ON "RoleBackup"("roleKey");

-- CreateIndex
CREATE INDEX "RoleBackup_backupUserId_idx" ON "RoleBackup"("backupUserId");

-- CreateIndex
CREATE INDEX "RoleGapReview_userId_roleKey_idx" ON "RoleGapReview"("userId", "roleKey");

-- AddForeignKey
ALTER TABLE "PersonRoleAssignment" ADD CONSTRAINT "PersonRoleAssignment_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileEntry" ADD CONSTRAINT "ProfileEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAssessment" ADD CONSTRAINT "PersonAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterEvidence" ADD CONSTRAINT "CharacterEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentPlan" ADD CONSTRAINT "DevelopmentPlan_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentObjective" ADD CONSTRAINT "DevelopmentObjective_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DevelopmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentEvidence" ADD CONSTRAINT "DevelopmentEvidence_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "DevelopmentObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentCommitment" ADD CONSTRAINT "DevelopmentCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentCommitment" ADD CONSTRAINT "DevelopmentCommitment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentMeeting" ADD CONSTRAINT "DevelopmentMeeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentMeeting" ADD CONSTRAINT "DevelopmentMeeting_withId_fkey" FOREIGN KEY ("withId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_aboutId_fkey" FOREIGN KEY ("aboutId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentOpportunity" ADD CONSTRAINT "DevelopmentOpportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBackup" ADD CONSTRAINT "RoleBackup_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleGapReview" ADD CONSTRAINT "RoleGapReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

