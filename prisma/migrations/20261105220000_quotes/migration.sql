-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PRESENTED', 'SUPERSEDED', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "docLang" "Lang" NOT NULL DEFAULT 'EN';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "docLang" "Lang" NOT NULL DEFAULT 'EN',
ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "lang" "Lang" NOT NULL DEFAULT 'EN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "presentedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "solution" TEXT,
    "supplyPrimary" TEXT,
    "supplyAlt" TEXT,
    "promiseText" TEXT,
    "promiseCondition" TEXT,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "fxRate" DECIMAL(14,6),
    "fxSource" TEXT,
    "supplierCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplierSrc" TEXT,
    "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "freightSrc" TEXT,
    "otherCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherSrc" TEXT,
    "changeNote" TEXT,
    "protSale" DECIMAL(14,2),
    "protCost" DECIMAL(14,2),
    "protEsagra" DECIMAL(14,2),
    "protPolicy" INTEGER,
    "billTo" TEXT,
    "shipTo" TEXT,
    "leadMinDays" INTEGER,
    "leadMaxDays" INTEGER,
    "incoterm" TEXT,
    "paymentTerms" TEXT,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "condition" TEXT NOT NULL DEFAULT 'New & original',
    "supplierValidUntil" TIMESTAMP(3),
    "supplyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "decisionAt" TIMESTAMP(3),
    "decisionLabel" TEXT,
    "decisionPath" TEXT,
    "decisionEvidence" TEXT,
    "promiseDecideBy" TIMESTAMP(3),

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteScenario" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "leadMinDays" INTEGER NOT NULL,
    "leadMaxDays" INTEGER NOT NULL,
    "risk" TEXT NOT NULL,
    "promise" TEXT NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "why" TEXT,

    CONSTRAINT "QuoteScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_dealId_idx" ON "Quote"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_rev_key" ON "Quote"("number", "rev");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteScenario" ADD CONSTRAINT "QuoteScenario_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

