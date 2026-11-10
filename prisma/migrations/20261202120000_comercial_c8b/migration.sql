-- CreateTable
CREATE TABLE "CoverageAssignment" (
    "id" TEXT NOT NULL,
    "originalUserId" TEXT NOT NULL,
    "actingUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "handover" JSONB NOT NULL DEFAULT '{}',
    "createdByName" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipBackup" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "backupUserId" TEXT NOT NULL,
    "note" TEXT,
    "setByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverageAssignment_actingUserId_endsAt_idx" ON "CoverageAssignment"("actingUserId", "endsAt");

-- CreateIndex
CREATE INDEX "CoverageAssignment_originalUserId_endsAt_idx" ON "CoverageAssignment"("originalUserId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipBackup_accountId_key" ON "RelationshipBackup"("accountId");

-- AddForeignKey
ALTER TABLE "CoverageAssignment" ADD CONSTRAINT "CoverageAssignment_originalUserId_fkey" FOREIGN KEY ("originalUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAssignment" ADD CONSTRAINT "CoverageAssignment_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipBackup" ADD CONSTRAINT "RelationshipBackup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipBackup" ADD CONSTRAINT "RelationshipBackup_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
