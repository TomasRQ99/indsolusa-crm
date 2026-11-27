-- The office phone printed on the quote PDF header comes from the selling company's own row, which was created
-- with the old number. The owner confirmed the right one on 2026-11-27. Only rows still holding the old number
-- change; quotes already presented keep the details they were issued with.
UPDATE "SellingEntity" SET "phone" = '(305) 307 0051' WHERE "phone" = '(305) 307 0050';
