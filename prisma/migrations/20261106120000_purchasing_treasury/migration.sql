-- CreateEnum
CREATE TYPE "ExecutionState" AS ENUM ('SENT', 'UNCERTAIN', 'CONFIRMED', 'FAILED');

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "advancePct" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "transitDays" INTEGER;

-- AlterTable
ALTER TABLE "SupplierPO" ADD COLUMN     "costNote" TEXT,
ADD COLUMN     "history" JSONB,
ADD COLUMN     "incoterm" TEXT,
ADD COLUMN     "proformaRef" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedByName" TEXT,
ADD COLUMN     "shipBy" TIMESTAMP(3),
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "dupCheckNote" TEXT,
ADD COLUMN     "dupCheckedByName" TEXT,
ADD COLUMN     "requirementId" TEXT;

-- CreateTable
CREATE TABLE "SupplierPOLine" (
    "id" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SupplierPOLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequirement" (
    "id" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "trigger" TEXT NOT NULL,
    "dueBy" TIMESTAMP(3),

    CONSTRAINT "PaymentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentExecution" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "bankRef" TEXT,
    "state" "ExecutionState" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentExecution_paymentId_idx" ON "PaymentExecution"("paymentId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PaymentRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPOLine" ADD CONSTRAINT "SupplierPOLine_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequirement" ADD CONSTRAINT "PaymentRequirement_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentExecution" ADD CONSTRAINT "PaymentExecution_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing Supplier POs were real orders already placed: they count as released version 1.
UPDATE "SupplierPO" SET "releasedAt" = "createdAt" WHERE "releasedAt" IS NULL;

-- Existing executed payments were confirmed transfers: keep them as one CONFIRMED execution.
INSERT INTO "PaymentExecution" ("id", "paymentId", "amount", "sentAt", "bankRef", "state", "recordedById", "recordedByName", "resolvedAt", "resolvedByName", "evidence")
SELECT 'mig_' || md5(p."id"), p."id", p."amount", p."executedAt", p."executedRef", 'CONFIRMED', COALESCE(p."executedById", p."requestedById"), COALESCE(u."name", 'Migracion'), p."executedAt", COALESCE(u."name", 'Migracion'), 'Registrado antes de separar envio y confirmacion'
FROM "SupplierPayment" p LEFT JOIN "User" u ON u."id" = p."executedById"
WHERE p."executedAt" IS NOT NULL;