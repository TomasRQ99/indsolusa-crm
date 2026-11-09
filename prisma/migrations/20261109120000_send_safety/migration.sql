-- AlterTable
ALTER TABLE "OutboundMail" ADD COLUMN     "error" TEXT,
ADD COLUMN     "idemKey" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'SENT';

-- AlterTable
ALTER TABLE "Rfq" ADD COLUMN     "idemKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMail_idemKey_key" ON "OutboundMail"("idemKey");

-- CreateIndex
CREATE INDEX "OutboundMail_status_idx" ON "OutboundMail"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_idemKey_key" ON "Rfq"("idemKey");
