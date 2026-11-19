-- The "Localizar" step of a Need (2026-11-19): the exact piece was identified (photos, part number) and where it will
-- be looked for, before the source and its cost. And the drafts of customer emails written with AI, kept for audit.
ALTER TABLE "Deal" ADD COLUMN "locatedAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "locatedByName" TEXT;
ALTER TABLE "Deal" ADD COLUMN "locatedNote" TEXT;
ALTER TABLE "Deal" ADD COLUMN "locatedSupplierId" TEXT;

CREATE TABLE "AiDraft" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiDraft_dealId_idx" ON "AiDraft"("dealId");

ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
