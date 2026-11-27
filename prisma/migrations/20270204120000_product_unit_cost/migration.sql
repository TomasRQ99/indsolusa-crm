-- One cost per product (owner, 2026-11-27): what the supplier charges per unit, on the Need's products and on the
-- quote's lines. Additive and nullable: older records keep only their total until someone opens the cost sheet.
ALTER TABLE "DealItem" ADD COLUMN "unitCost" DECIMAL(14,2);
ALTER TABLE "QuoteLine" ADD COLUMN "unitCost" DECIMAL(14,2);

-- A Need or a quote with exactly one product and a known total: its unit cost is that total divided by its quantity
-- (only when it divides to the cent, so no total changes by itself).
UPDATE "DealItem" i SET "unitCost" = ROUND(COALESCE(d."supplierCostNative", d."supplierCost") / i."qty", 2)
FROM "Deal" d
WHERE d."id" = i."dealId" AND i."qty" > 0 AND COALESCE(d."supplierCostNative", d."supplierCost") > 0
  AND (SELECT COUNT(*) FROM "DealItem" x WHERE x."dealId" = d."id") = 1
  AND ROUND(COALESCE(d."supplierCostNative", d."supplierCost") / i."qty", 2) * i."qty" = COALESCE(d."supplierCostNative", d."supplierCost");

UPDATE "QuoteLine" l SET "unitCost" = ROUND(q."supplierCost" / l."qty", 2)
FROM "Quote" q
WHERE q."id" = l."quoteId" AND l."qty" > 0 AND q."supplierCost" > 0
  AND (SELECT COUNT(*) FROM "QuoteLine" x WHERE x."quoteId" = q."id") = 1
  AND ROUND(q."supplierCost" / l."qty", 2) * l."qty" = q."supplierCost";
