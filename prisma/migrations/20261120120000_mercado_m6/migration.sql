-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "explorationId" TEXT,
ADD COLUMN     "needContext" JSONB,
ADD COLUMN     "originRef" TEXT,
ADD COLUMN     "plantId" TEXT;

-- CreateTable
CREATE TABLE "NeedDismissal" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "note" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeedDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NeedDismissal_ref_key" ON "NeedDismissal"("ref");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_explorationId_fkey" FOREIGN KEY ("explorationId") REFERENCES "Exploration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
