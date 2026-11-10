-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "collectAt" TIMESTAMP(3),
ADD COLUMN     "collectByName" TEXT,
ADD COLUMN     "collectContact" TEXT,
ADD COLUMN     "collectNext" TEXT,
ADD COLUMN     "collectNextAt" TIMESTAMP(3),
ADD COLUMN     "collectWaitingFor" TEXT;

-- AlterTable
ALTER TABLE "PaymentPromise" ADD COLUMN     "amount" DECIMAL(14,2),
ADD COLUMN     "promisedByRole" TEXT,
ADD COLUMN     "replacedAt" TIMESTAMP(3),
ADD COLUMN     "replacedById" TEXT;

-- CreateTable
CREATE TABLE "CashBlocker" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "shipmentId" TEXT,
    "deliveryId" TEXT,
    "invoiceId" TEXT,
    "readyAt" TIMESTAMP(3),
    "blockedSince" TIMESTAMP(3) NOT NULL,
    "blockedValue" DECIMAL(14,2) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "secondaryCause" TEXT,
    "narrative" TEXT NOT NULL,
    "evidence" TEXT,
    "responsibleId" TEXT NOT NULL,
    "nextMovement" TEXT NOT NULL,
    "expectedResolution" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceStep" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "reason" TEXT,
    "evidence" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMap" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "process" TEXT,
    "portal" TEXT,
    "payDays" TEXT,
    "documents" TEXT,
    "notes" TEXT,
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMapPerson" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "PaymentMapPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReviewRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dealId" TEXT,
    "kind" TEXT NOT NULL,
    "requestedLimit" DECIMAL(14,2),
    "requestedTerms" INTEGER,
    "until" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "info" TEXT,
    "alternatives" TEXT[],
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "approvedLimit" DECIMAL(14,2),
    "approvedTerms" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashBlocker_dealId_idx" ON "CashBlocker"("dealId");

-- CreateIndex
CREATE INDEX "CashBlocker_resolvedAt_idx" ON "CashBlocker"("resolvedAt");

-- CreateIndex
CREATE INDEX "InvoiceStep_invoiceId_idx" ON "InvoiceStep"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMap_accountId_key" ON "PaymentMap"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMapPerson_mapId_role_contactId_key" ON "PaymentMapPerson"("mapId", "role", "contactId");

-- CreateIndex
CREATE INDEX "CreditReviewRequest_accountId_idx" ON "CreditReviewRequest"("accountId");

-- CreateIndex
CREATE INDEX "CreditReviewRequest_status_idx" ON "CreditReviewRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPromise_replacedById_key" ON "PaymentPromise"("replacedById");

-- AddForeignKey
ALTER TABLE "PaymentPromise" ADD CONSTRAINT "PaymentPromise_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "PaymentPromise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBlocker" ADD CONSTRAINT "CashBlocker_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBlocker" ADD CONSTRAINT "CashBlocker_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStep" ADD CONSTRAINT "InvoiceStep_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMap" ADD CONSTRAINT "PaymentMap_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMapPerson" ADD CONSTRAINT "PaymentMapPerson_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "PaymentMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMapPerson" ADD CONSTRAINT "PaymentMapPerson_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReviewRequest" ADD CONSTRAINT "CreditReviewRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReviewRequest" ADD CONSTRAINT "CreditReviewRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReviewRequest" ADD CONSTRAINT "CreditReviewRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReviewRequest" ADD CONSTRAINT "CreditReviewRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
