-- CreateTable
CREATE TABLE "CarrierRatingRule" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL DEFAULT '',
    "divisor" INTEGER NOT NULL DEFAULT 5000,
    "roundingKg" DECIMAL(6,2) NOT NULL DEFAULT 0.5,
    "minChargeKg" DECIMAL(8,2),
    "tolerancePct" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "toleranceUsd" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "claimPct" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierRatingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierInvoice" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "service" TEXT,
    "number" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(14,2) NOT NULL,
    "billedKg" DECIMAL(10,2),
    "billedPieces" INTEGER,
    "surcharges" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "audit" JSONB NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightClaim" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "disputedAmount" DECIMAL(14,2) NOT NULL,
    "expectedCalc" TEXT NOT NULL,
    "billedCalc" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "creditNote" TEXT,
    "recoveredAmount" DECIMAL(14,2),
    "recoveredAt" TIMESTAMP(3),
    "openedByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreightClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsCase" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "broker" TEXT,
    "consignee" TEXT,
    "declarationNo" TEXT,
    "classification" TEXT,
    "classificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "classificationSource" TEXT,
    "origin" TEXT,
    "declaredValue" DECIMAL(14,2),
    "hasTransportDoc" BOOLEAN NOT NULL DEFAULT false,
    "permits" TEXT,
    "dutiesExpected" DECIMAL(14,2),
    "dutiesActual" DECIMAL(14,2),
    "vatTreatment" TEXT,
    "inspection" TEXT,
    "holdReason" TEXT,
    "correctiveSteps" TEXT,
    "expectedDays" INTEGER,
    "arrivedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomsCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierRatingRule_carrier_service_key" ON "CarrierRatingRule"("carrier", "service");

-- CreateIndex
CREATE INDEX "CarrierInvoice_shipmentId_idx" ON "CarrierInvoice"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierInvoice_carrier_number_key" ON "CarrierInvoice"("carrier", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FreightClaim_invoiceId_key" ON "FreightClaim"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsCase_shipmentId_key" ON "CustomsCase"("shipmentId");

-- AddForeignKey
ALTER TABLE "CarrierInvoice" ADD CONSTRAINT "CarrierInvoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightClaim" ADD CONSTRAINT "FreightClaim_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CarrierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsCase" ADD CONSTRAINT "CustomsCase_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Decision O-09: common express starting values, to confirm against each contract; review above 3 %, claim above 10 %.
INSERT INTO "CarrierRatingRule" ("id", "carrier", "service", "note", "updatedAt") VALUES ('crr_default', 'DEFAULT', '', 'Valor inicial; aplica a transportadores sin regla propia', CURRENT_TIMESTAMP), ('crr_dhl', 'DHL', '', 'Valor inicial; confirmar contra el contrato', CURRENT_TIMESTAMP), ('crr_fedex', 'FEDEX', '', 'Valor inicial; confirmar contra el contrato', CURRENT_TIMESTAMP), ('crr_ups', 'UPS', '', 'Valor inicial; confirmar contra el contrato', CURRENT_TIMESTAMP);