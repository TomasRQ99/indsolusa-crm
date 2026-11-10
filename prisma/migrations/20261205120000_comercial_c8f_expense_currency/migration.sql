-- AlterTable
ALTER TABLE "MissionExpense" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "fxRate" DECIMAL(12,2),
ADD COLUMN     "fxSource" TEXT,
ADD COLUMN     "originalAmount" DECIMAL(16,2);
