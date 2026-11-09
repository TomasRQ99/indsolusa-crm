-- AlterTable
ALTER TABLE "DatasetImport" ADD COLUMN     "reportYear" INTEGER;


-- Backfill: committed imports report the highest fiscal year they saved.
UPDATE "DatasetImport" d SET "reportYear" = (SELECT max(s."fiscalYear") FROM "FinancialSnapshot" s WHERE s."importId" = d.id) WHERE d."reportYear" IS NULL;