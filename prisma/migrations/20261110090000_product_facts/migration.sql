-- CreateTable
CREATE TABLE "ProductFact" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductFact_code_idx" ON "ProductFact"("code");

