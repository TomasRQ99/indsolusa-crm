-- The phone a person signs their emails with (owner, 2026-11-27). Empty = the company's phone.
ALTER TABLE "User" ADD COLUMN "signaturePhone" TEXT;
