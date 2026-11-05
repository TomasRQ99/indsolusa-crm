-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "offerValidUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "outlookEventId" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "outlookConnectedAt" TIMESTAMP(3);

