-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "WebSource" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "title" TEXT,
    "mpnSeen" TEXT,
    "brand" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(14,4),
    "currency" TEXT,
    "priceBreaks" JSONB,
    "stock" INTEGER,
    "availability" TEXT,
    "leadText" TEXT,
    "lifecycle" TEXT,
    "datasheetUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebCache" (
    "url" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "contentType" TEXT,
    "body" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebCache_pkey" PRIMARY KEY ("url")
);

-- CreateIndex
CREATE INDEX "WebSource_partId_idx" ON "WebSource"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "WebSource_partId_url_key" ON "WebSource"("partId", "url");

-- AddForeignKey
ALTER TABLE "WebSource" ADD CONSTRAINT "WebSource_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

