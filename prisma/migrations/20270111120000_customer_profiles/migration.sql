-- Comercial · Perfiles: customer diary (Sandler / ECSA), reading of the person, and profile material. Additive only.
-- CreateTable
CREATE TABLE "ProfileDiaryEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "activityId" TEXT,
    "happenedOn" TIMESTAMP(3) NOT NULL,
    "ecsa" TEXT,
    "pain" TEXT,
    "struggle" TEXT,
    "impact" TEXT,
    "personal" TEXT,
    "budget" TEXT,
    "decision" TEXT,
    "agreement" TEXT,
    "notes" TEXT,
    "followUp" TEXT,
    "followUpOn" TIMESTAMP(3),
    "taskId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonReading" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "observedOn" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "url" TEXT,
    "fileName" TEXT,
    "mime" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileDiaryEntry_accountId_happenedOn_idx" ON "ProfileDiaryEntry"("accountId", "happenedOn");

-- CreateIndex
CREATE INDEX "ProfileDiaryEntry_activityId_idx" ON "ProfileDiaryEntry"("activityId");

-- CreateIndex
CREATE INDEX "PersonReading_contactId_idx" ON "PersonReading"("contactId");

-- CreateIndex
CREATE INDEX "ProfileItem_accountId_kind_idx" ON "ProfileItem"("accountId", "kind");

-- AddForeignKey
ALTER TABLE "ProfileDiaryEntry" ADD CONSTRAINT "ProfileDiaryEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDiaryEntry" ADD CONSTRAINT "ProfileDiaryEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonReading" ADD CONSTRAINT "PersonReading_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileItem" ADD CONSTRAINT "ProfileItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
