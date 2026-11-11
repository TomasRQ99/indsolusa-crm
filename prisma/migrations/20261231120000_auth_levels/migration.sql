-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authLevel" TEXT;

-- CreateTable
CREATE TABLE "DealAuthorization" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "amountUsd" DECIMAL(14,2) NOT NULL,
    "amountCop" DECIMAL(18,2) NOT NULL,
    "trm" DECIMAL(12,2) NOT NULL,
    "trmSource" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "authorizedBy" TEXT NOT NULL,
    "mentorInformed" TEXT,
    "partnersNote" TEXT,
    "note" TEXT,
    "policyVersion" INTEGER NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealAuthorization_dealId_idx" ON "DealAuthorization"("dealId");

-- AddForeignKey
ALTER TABLE "DealAuthorization" ADD CONSTRAINT "DealAuthorization_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

