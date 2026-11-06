-- CreateTable
CREATE TABLE "SupplierDoc" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT,
    "issuedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "currency" TEXT,
    "incoterm" TEXT,
    "leadText" TEXT,
    "paymentTerms" TEXT,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "text" TEXT,
    "bankWarning" TEXT,
    "rfqRecipientId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "docId" TEXT,
    "codeAsQuoted" TEXT NOT NULL,
    "description" TEXT,
    "qty" INTEGER,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "leadDaysMin" INTEGER,
    "leadDaysMax" INTEGER,
    "leadText" TEXT,
    "validUntil" TIMESTAMP(3),
    "incoterm" TEXT,
    "condition" TEXT,
    "source" TEXT,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dealId" TEXT,
    "items" JSONB NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'EN',
    "neededBy" TIMESTAMP(3),
    "notes" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqRecipient" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "RfqRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierDoc_rfqRecipientId_key" ON "SupplierDoc"("rfqRecipientId");

-- CreateIndex
CREATE INDEX "SupplierDoc_supplierId_idx" ON "SupplierDoc"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierOffer_partId_idx" ON "SupplierOffer"("partId");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierId_idx" ON "SupplierOffer"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_code_key" ON "Rfq"("code");

-- CreateIndex
CREATE INDEX "RfqRecipient_rfqId_idx" ON "RfqRecipient"("rfqId");

-- CreateIndex
CREATE INDEX "RfqRecipient_supplierId_idx" ON "RfqRecipient"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierDoc" ADD CONSTRAINT "SupplierDoc_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDoc" ADD CONSTRAINT "SupplierDoc_rfqRecipientId_fkey" FOREIGN KEY ("rfqRecipientId") REFERENCES "RfqRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_docId_fkey" FOREIGN KEY ("docId") REFERENCES "SupplierDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqRecipient" ADD CONSTRAINT "RfqRecipient_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqRecipient" ADD CONSTRAINT "RfqRecipient_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

