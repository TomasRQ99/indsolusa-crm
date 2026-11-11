-- CreateTable
CREATE TABLE "PolicyChangeRequest" (
    "id" TEXT NOT NULL,
    "current" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "PolicyChangeRequest_pkey" PRIMARY KEY ("id")
);

