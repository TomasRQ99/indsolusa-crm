-- CreateTable
CREATE TABLE "AccountDocument" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "extracted" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDocument_accountId_idx" ON "AccountDocument"("accountId");

-- AddForeignKey
ALTER TABLE "AccountDocument" ADD CONSTRAINT "AccountDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

