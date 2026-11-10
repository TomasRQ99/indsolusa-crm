-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;
