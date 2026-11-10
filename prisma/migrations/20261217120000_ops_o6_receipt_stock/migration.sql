-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "packages" INTEGER,
    "grossKg" DECIMAL(10,2),
    "dims" TEXT,
    "packagingOk" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "qtyExpected" INTEGER NOT NULL,
    "qtyReceived" INTEGER NOT NULL,
    "identityOk" BOOLEAN NOT NULL,
    "conditionOk" BOOLEAN NOT NULL,
    "completeOk" BOOLEAN NOT NULL,
    "docsOk" BOOLEAN NOT NULL,
    "serials" TEXT,
    "exceptionKind" TEXT,
    "exceptionNote" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "dealId" TEXT,
    "stateNote" TEXT,
    "stateByName" TEXT,
    "stateAt" TIMESTAMP(3),
    "outAt" TIMESTAMP(3),
    "outNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptPhoto" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_key_key" ON "StockLocation"("key");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_code_key" ON "GoodsReceipt"("code");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierPoId_idx" ON "GoodsReceipt"("supplierPoId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "StockLot_locationId_state_idx" ON "StockLot"("locationId", "state");

-- CreateIndex
CREATE INDEX "StockLot_dealId_idx" ON "StockLot"("dealId");

-- CreateIndex
CREATE INDEX "GoodsReceiptPhoto_receiptId_idx" ON "GoodsReceiptPhoto"("receiptId");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "SupplierPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptPhoto" ADD CONSTRAINT "GoodsReceiptPhoto_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Decision O-01: goods are received in Miami and in Colombia.
INSERT INTO "StockLocation" ("id", "key", "name", "country", "active") VALUES ('loc_miami', 'MIAMI', 'Bodega Miami', 'USA', true), ('loc_colombia', 'COLOMBIA', 'Bodega Colombia', 'Colombia', true);