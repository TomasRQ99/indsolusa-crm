-- Presupuesto comercial works in dollars from here on (owner's decision, 2026-11-26). Data only: no table changes.
-- Figures loaded in dollars go back to exactly what was loaded. Figures typed in pesos (goals, reforecasts, company
-- objectives, average ticket) are turned into dollars once, at the latest official TRM stored (4000 if none).

-- History loaded in dollars: the stored value is the original figure again.
UPDATE "SalesHistoryMonth" SET "value" = "orig", "rate" = NULL WHERE "currency" = 'USD';
-- History loaded in pesos: dollars at the month's average official TRM (the latest one when the month has none).
UPDATE "SalesHistoryMonth" h
SET "rate" = r.rate, "value" = round(h."orig" / r.rate, 2)
FROM (
  SELECT m.id, COALESCE(
    (SELECT round(avg(t."rate"), 2) FROM "TrmDay" t WHERE left(t."day", 7) = m."month"),
    (SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1),
    4000) AS rate
  FROM "SalesHistoryMonth" m WHERE m."currency" = 'COP'
) r
WHERE h.id = r.id;

-- Goals, reforecasts and their cuts.
UPDATE "SalesBudgetLine" l
SET "value" = round(l."value" / r.rate, 2), "suggested" = round(l."suggested" / r.rate, 2)
FROM (SELECT COALESCE((SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1), 4000) AS rate) r
WHERE l."kpi" IN ('OC_COP', 'FACT_COP', 'ESA_COP', 'COT_COP');

UPDATE "SalesForecastLine" l
SET "value" = round(l."value" / r.rate, 2)
FROM (SELECT COALESCE((SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1), 4000) AS rate) r;

UPDATE "SalesForecast" f
SET "estOc" = round(f."estOc" / r.rate, 2), "estFact" = round(f."estFact" / r.rate, 2)
FROM (SELECT COALESCE((SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1), 4000) AS rate) r;

-- Average ticket inside a budget's assumptions.
UPDATE "SalesBudget" b
SET "assumptions" = jsonb_set(b."assumptions"::jsonb, '{ticket}', to_jsonb(round((b."assumptions"::jsonb ->> 'ticket')::numeric / r.rate, 2)))
FROM (SELECT COALESCE((SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1), 4000) AS rate) r
WHERE jsonb_typeof(b."assumptions"::jsonb -> 'ticket') = 'number';

-- The company's objectives of the year.
UPDATE "SalesBudgetYear" y
SET "corporate" = (
  SELECT jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'number' THEN to_jsonb(round((e.value #>> '{}')::numeric / r.rate, 2)) ELSE e.value END)
  FROM jsonb_each(y."corporate"::jsonb) e)
FROM (SELECT COALESCE((SELECT t."rate" FROM "TrmDay" t ORDER BY t."day" DESC LIMIT 1), 4000) AS rate) r
WHERE y."corporate" IS NOT NULL AND jsonb_typeof(y."corporate"::jsonb) = 'object' AND y."corporate"::jsonb <> '{}'::jsonb;

-- The day's priorities are a saved reading written in pesos: they are prepared again in dollars.
DELETE FROM "SalesInsight";
