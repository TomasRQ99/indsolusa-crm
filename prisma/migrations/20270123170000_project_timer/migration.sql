-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "quietUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectPost" ADD COLUMN     "customerInput" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customerName" TEXT;

-- CreateTable
CREATE TABLE "ProjectExtension" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExtension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectExtension_status_idx" ON "ProjectExtension"("status");

-- CreateIndex
CREATE INDEX "ProjectExtension_projectId_idx" ON "ProjectExtension"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectExtension" ADD CONSTRAINT "ProjectExtension_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
