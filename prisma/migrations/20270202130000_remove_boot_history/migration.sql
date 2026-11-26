-- The owner asked to remove the 2025-2026 sales SOLU loaded by itself: they upload their own Excel files on
-- Presupuesto comercial → Historial. The rows go with their load (cascade). Customers are not touched.
DELETE FROM "SalesHistoryBatch" WHERE "raw" LIKE 'boot:industry-sales-2025-2026%';
