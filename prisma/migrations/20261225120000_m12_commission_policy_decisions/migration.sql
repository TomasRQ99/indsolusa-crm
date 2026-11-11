-- AlterTable
ALTER TABLE "CommissionPolicy" ADD COLUMN     "commercialPct" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "operationalPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proportionalCollection" BOOLEAN NOT NULL DEFAULT false;


-- Decisions given by the user on 2026-11-11 (docs/rentabilidad-12-fit-and-plan.md R-06…R-12): a new policy VERSION,
-- in force for Journeys whose customer PO is accepted from that date. Earlier versions and paid entries are untouched.
INSERT INTO "CommissionPolicy" ("id", "version", "effectiveFrom", "tiers", "newClientBonus", "salePercent", "lossDays", "approvedBy", "notes", "commercialPct", "operationalPct", "proportionalCollection", "createdAt")
SELECT 'cp_m12_20261111', COALESCE(MAX("version"), 0) + 1, '2026-11-11T00:00:00Z', '[{"min":0,"rate":10}]'::jsonb, 0, 50, 0, 'Gerencia', 'Decisión del 11-nov-2026: 10 % de la Eságara, sin bono por cliente nuevo, fondo 50 % Comercial y 50 % Operativo, 50 % al facturar y 50 % en proporción al recaudo.', 50, 50, true, NOW()
FROM "CommissionPolicy";

-- Cost of money: 6 % a year (same decision), as a new version of the company rate.
INSERT INTO "MarketSetting" ("id", "key", "version", "value", "updatedByName", "createdAt")
SELECT 'ms_fin_20261111', 'financeRate', COALESCE(MAX("version"), 0) + 1, '{"annualPct":6,"note":"Decisión de Gerencia del 11-nov-2026"}'::jsonb, 'Gerencia', NOW()
FROM "MarketSetting" WHERE "key" = 'financeRate';