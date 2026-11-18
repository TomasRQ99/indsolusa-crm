-- New request form of a Need: notes for internal use, the customer's machine, and files (photos, PDF). Additive.
-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "machine" TEXT;

-- CreateTable
CREATE TABLE "NeedFile" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NeedFile_dealId_idx" ON "NeedFile"("dealId");

-- AddForeignKey
ALTER TABLE "NeedFile" ADD CONSTRAINT "NeedFile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
