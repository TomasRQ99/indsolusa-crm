-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "originalPromisedDate" TIMESTAMP(3),
ADD COLUMN     "promiseChangeCause" TEXT,
ADD COLUMN     "promiseRevisedAt" TIMESTAMP(3),
ADD COLUMN     "promiseRevisions" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Recovery" ADD COLUMN     "cause" TEXT;

-- CreateTable
CREATE TABLE "ProductSignal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "screen" TEXT,
    "note" TEXT NOT NULL,
    "reportedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ProductSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSignal_createdAt_idx" ON "ProductSignal"("createdAt");


-- Backfill: the current promise is the original one for existing Journeys.
UPDATE "Deal" SET "originalPromisedDate" = "promisedDate" WHERE "promisedDate" IS NOT NULL;
