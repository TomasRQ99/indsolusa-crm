-- Fuzzy search for part numbers and accent-insensitive search for descriptions (both available on Neon).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "mpn" TEXT NOT NULL,
    "mpnKey" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "category" TEXT,
    "gtin" TEXT,
    "condition" TEXT,
    "lifecycle" TEXT,
    "specs" JSONB,
    "compatibleModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "mergedIntoId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartAlias" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "brand" TEXT,
    "source" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Part_mpnKey_key" ON "Part"("mpnKey");

-- CreateIndex
CREATE INDEX "Part_brand_idx" ON "Part"("brand");

-- CreateIndex
CREATE INDEX "Part_mergedIntoId_idx" ON "Part"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Part_mpnKey_trgm" ON "Part" USING GIN ("mpnKey" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PartAlias_codeKey_idx" ON "PartAlias"("codeKey");

-- CreateIndex
CREATE INDEX "PartAlias_codeKey_trgm" ON "PartAlias" USING GIN ("codeKey" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "PartAlias_partId_codeKey_key" ON "PartAlias"("partId", "codeKey");

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartAlias" ADD CONSTRAINT "PartAlias_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

