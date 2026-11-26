-- CreateTable
CREATE TABLE "WebHunt" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answers" JSONB,
    "lang" TEXT NOT NULL DEFAULT 'ES',
    "partId" TEXT,
    "dealId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "failCode" TEXT,
    "failNote" TEXT,
    "understood" JSONB,
    "summary" TEXT,
    "questions" JSONB,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,5),
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WebHunt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebLead" (
    "id" TEXT NOT NULL,
    "huntId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "seller" TEXT NOT NULL,
    "sellerKind" TEXT NOT NULL DEFAULT 'OTHER',
    "country" TEXT,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "title" TEXT,
    "match" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" TEXT,
    "mpnSeen" TEXT,
    "price" DECIMAL(14,4),
    "currency" TEXT,
    "availability" TEXT,
    "condition" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contactUrl" TEXT,
    "contactFrom" TEXT,
    "note" TEXT,
    "checked" TEXT,
    "checkedWhy" TEXT,
    "linkKnown" BOOLEAN,
    "dealId" TEXT,
    "savedByName" TEXT,
    "savedAt" TIMESTAMP(3),
    "supplierId" TEXT,
    "sourceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebHunt_createdAt_idx" ON "WebHunt"("createdAt");

-- CreateIndex
CREATE INDEX "WebHunt_dealId_idx" ON "WebHunt"("dealId");

-- CreateIndex
CREATE INDEX "WebLead_huntId_idx" ON "WebLead"("huntId");

-- CreateIndex
CREATE INDEX "WebLead_dealId_idx" ON "WebLead"("dealId");

-- AddForeignKey
ALTER TABLE "WebHunt" ADD CONSTRAINT "WebHunt_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebHunt" ADD CONSTRAINT "WebHunt_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebLead" ADD CONSTRAINT "WebLead_huntId_fkey" FOREIGN KEY ("huntId") REFERENCES "WebHunt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebLead" ADD CONSTRAINT "WebLead_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebLead" ADD CONSTRAINT "WebLead_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

