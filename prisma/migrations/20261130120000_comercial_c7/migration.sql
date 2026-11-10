-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "valueKind" TEXT;

-- CreateTable
CREATE TABLE "GoalTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "target" DECIMAL(14,2) NOT NULL,
    "rationale" TEXT,
    "setByName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalTarget_userId_period_idx" ON "GoalTarget"("userId", "period");

-- AddForeignKey
ALTER TABLE "GoalTarget" ADD CONSTRAINT "GoalTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
