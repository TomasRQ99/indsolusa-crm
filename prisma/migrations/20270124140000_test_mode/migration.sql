-- Modo prueba: each person chooses in Mi perfil whether they see test information. Nothing is deleted.
ALTER TABLE "User" ADD COLUMN     "testMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Account" ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Supplier" ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Starting point: what the team already named as a test (same rule the credit-limit page uses). It can be
-- changed one by one in Mi perfil → Modo prueba.
UPDATE "Account" SET "isTest" = true WHERE "name" ILIKE 'prueba%' AND "internal" = false AND "isDemo" = false;
UPDATE "Supplier" SET "isTest" = true WHERE "name" ILIKE 'prueba%' AND "isDemo" = false;
