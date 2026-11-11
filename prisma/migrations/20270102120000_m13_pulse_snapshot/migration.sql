-- CreateTable
CREATE TABLE "PulseSnapshot" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "closedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByName" TEXT,
    "reopenReason" TEXT,

    CONSTRAINT "PulseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PulseSnapshot_period_version_key" ON "PulseSnapshot"("period", "version");

