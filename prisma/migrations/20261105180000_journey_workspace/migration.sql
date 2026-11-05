-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "phase" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "uncertain" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "impactIfNot" TEXT,
ADD COLUMN     "incoterm" TEXT,
ADD COLUMN     "needSpecs" TEXT,
ADD COLUMN     "neededBy" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "quoteSentAt" TIMESTAMP(3),
ADD COLUMN     "resultNote" TEXT,
ADD COLUMN     "sourcingNote" TEXT,
ADD COLUMN     "successMeasure" TEXT;

-- AlterTable
ALTER TABLE "SupplierPO" ADD COLUMN     "carrierEta" TIMESTAMP(3),
ADD COLUMN     "carrierEtaAt" TIMESTAMP(3),
ADD COLUMN     "carrierEtaSource" TEXT,
ADD COLUMN     "carrierName" TEXT,
ADD COLUMN     "tracking" TEXT;

-- CreateTable
CREATE TABLE "JourneyView" (
    "userId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "prevSeenAt" TIMESTAMP(3),

    CONSTRAINT "JourneyView_pkey" PRIMARY KEY ("userId","dealId")
);

-- AddForeignKey
ALTER TABLE "JourneyView" ADD CONSTRAINT "JourneyView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyView" ADD CONSTRAINT "JourneyView_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

