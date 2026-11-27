-- The customer's shipping address, apart from the billing one (Account.address …).
-- shipSame = the goods go to the billing address; every existing customer starts that way.
ALTER TABLE "Account" ADD COLUMN "shipSame" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "shipAddress" TEXT,
ADD COLUMN "shipCountry" TEXT,
ADD COLUMN "shipRegion" TEXT,
ADD COLUMN "shipCity" TEXT,
ADD COLUMN "shipPostalCode" TEXT;
