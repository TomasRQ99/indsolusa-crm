-- CreateTable
CREATE TABLE "ReportView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportView_ownerId_idx" ON "ReportView"("ownerId");

-- AddForeignKey
ALTER TABLE "ReportView" ADD CONSTRAINT "ReportView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
