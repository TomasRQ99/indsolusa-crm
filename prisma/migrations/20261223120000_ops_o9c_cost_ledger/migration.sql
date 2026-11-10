-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "economicsAt" TIMESTAMP(3),
ADD COLUMN     "economicsByName" TEXT,
ADD COLUMN     "economicsFinal" JSONB,
ADD COLUMN     "economicsNote" TEXT,
ADD COLUMN     "economicsState" TEXT NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "DealCost" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "sharedId" TEXT,
    "sharedTotal" DECIMAL(14,2),
    "splitMethod" TEXT,
    "splitNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealCost_dealId_idx" ON "DealCost"("dealId");

-- CreateIndex
CREATE INDEX "DealCost_sharedId_idx" ON "DealCost"("sharedId");

-- AddForeignKey
ALTER TABLE "DealCost" ADD CONSTRAINT "DealCost_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

