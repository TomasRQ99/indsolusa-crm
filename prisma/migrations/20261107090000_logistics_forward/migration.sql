-- CreateEnum
CREATE TYPE "ShipmentMode" AS ENUM ('AIR', 'COURIER', 'OCEAN', 'GROUND');

-- CreateEnum
CREATE TYPE "CustomsState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'HOLD', 'CLEARED');

-- CreateEnum
CREATE TYPE "ReceiptState" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ShipEventKind" AS ENUM ('SCAN', 'ETA_CHANGE', 'EXCEPTION', 'CUSTOMS', 'DELIVERED', 'NOTE');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "supplierPoId" TEXT,
    "carrierName" TEXT NOT NULL,
    "tracking" TEXT,
    "mode" "ShipmentMode" NOT NULL DEFAULT 'AIR',
    "origin" TEXT,
    "destination" TEXT,
    "destLat" DOUBLE PRECISION,
    "destLng" DOUBLE PRECISION,
    "international" BOOLEAN NOT NULL DEFAULT true,
    "toCustomer" BOOLEAN NOT NULL DEFAULT false,
    "plannedRts" TIMESTAMP(3),
    "rtsAt" TIMESTAMP(3),
    "plannedPickup" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "plannedDelivery" TIMESTAMP(3),
    "carrierEta" TIMESTAMP(3),
    "carrierEtaAt" TIMESTAMP(3),
    "carrierEtaSource" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredNote" TEXT,
    "customs" "CustomsState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "customsNote" TEXT,
    "docs" JSONB,
    "receipt" "ReceiptState" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3),
    "receivedByName" TEXT,
    "receiptNote" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeNote" TEXT,
    "deliveryId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "dealItemId" TEXT,
    "qty" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" "ShipEventKind" NOT NULL DEFAULT 'SCAN',
    "location" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "text" TEXT NOT NULL,
    "material" BOOLEAN NOT NULL DEFAULT false,
    "etaBefore" TIMESTAMP(3),
    "etaAfter" TIMESTAMP(3),
    "source" TEXT,
    "recordedByName" TEXT,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentDecision" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "option" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "newExpected" TIMESTAMP(3),
    "decidedByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_code_key" ON "Shipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_deliveryId_key" ON "Shipment"("deliveryId");

-- CreateIndex
CREATE INDEX "Shipment_dealId_idx" ON "Shipment"("dealId");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_at_idx" ON "ShipmentEvent"("shipmentId", "at");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDecision" ADD CONSTRAINT "ShipmentDecision_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing in-transit Supplier POs become Shipments, so the carrier's truth lives on the Shipment.
INSERT INTO "Shipment" ("id", "code", "dealId", "supplierPoId", "carrierName", "tracking", "international", "customs", "pickedUpAt", "plannedDelivery", "carrierEta", "carrierEtaAt", "carrierEtaSource", "createdByName")
SELECT 'mig_' || md5(p."id"), 'SHPM-' || p."code", p."dealId", p."id", COALESCE(p."carrierName", s."name"), p."tracking",
       NOT (COALESCE(s."country", '') ILIKE 'colombia'),
       CASE WHEN COALESCE(s."country", '') ILIKE 'colombia' THEN 'NOT_REQUIRED'::"CustomsState" ELSE 'PENDING'::"CustomsState" END,
       p."shippedAt", COALESCE(p."carrierEta", p."eta"), COALESCE(p."carrierEta", p."eta"), p."carrierEtaAt",
       COALESCE(p."carrierEtaSource", CASE WHEN p."carrierEta" IS NULL AND p."eta" IS NOT NULL THEN 'ETA del proveedor' END), 'Migracion'
FROM "SupplierPO" p JOIN "Supplier" s ON s."id" = p."supplierId"
WHERE p."shippedAt" IS NOT NULL AND p."receivedAt" IS NULL;