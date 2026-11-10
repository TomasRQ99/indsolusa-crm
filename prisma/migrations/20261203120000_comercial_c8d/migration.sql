-- CreateTable
CREATE TABLE "VisitAttachment" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitAttachment_visitId_idx" ON "VisitAttachment"("visitId");

-- AddForeignKey
ALTER TABLE "VisitAttachment" ADD CONSTRAINT "VisitAttachment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "VisitPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
