-- Mercado · Explorar prospectos (Apollo): people revealed from Apollo, and the usage log behind the monthly cap.
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "apolloId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "emailStatus" TEXT,
    "linkedinUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "orgName" TEXT,
    "orgDomain" TEXT,
    "orgWebsite" TEXT,
    "orgIndustry" TEXT,
    "orgEmployees" INTEGER,
    "foundWith" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "contactId" TEXT,
    "accountId" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "revealedById" TEXT NOT NULL,
    "revealedByName" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApolloUsage" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApolloUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Prospect_apolloId_key" ON "Prospect"("apolloId");
CREATE INDEX "Prospect_status_revealedAt_idx" ON "Prospect"("status", "revealedAt");
CREATE INDEX "ApolloUsage_createdAt_idx" ON "ApolloUsage"("createdAt");
