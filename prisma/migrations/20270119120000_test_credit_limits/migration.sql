-- Manual testing (owner, 2026-11-19: "agrandar cupos para que no sean un problema al hacer testing manual"):
-- sample customers ("(ejemplo)") and test customers ("Prueba…") get a credit limit large enough not to stop an order.
-- Real customers are not touched; Gerencia can widen them from Administración → Cupos de crédito.
UPDATE "Account"
SET "creditLimit" = 1000000
WHERE "internal" = false
  AND ("name" LIKE '%(ejemplo)' OR "name" ILIKE 'prueba%')
  AND ("creditLimit" IS NULL OR "creditLimit" < 1000000);
